"""Daily reports."""

import logging
from datetime import datetime, timedelta

from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from applications.audit import log_audit
from applications.audit_actions import AuditAction
from common.params import uuid_param
from common.permissions import has_global_access
from emails.config import EmailConfig
from emails.services.daily_report_emails import DailyReportEmailManager

from ..models import (
    DailyReport,
    DailyReportComment,
    DailyReportSubreport,
)
from ..serializers import (
    DailyReportCommentCreateSerializer,
    DailyReportCommentSerializer,
    DailyReportCreateSerializer,
    DailyReportDetailSerializer,
    DailyReportSendEmailSerializer,
    DailyReportSubreportCreateSerializer,
    DailyReportSubreportDetailSerializer,
    DailyReportSummarySerializer,
)

logger = logging.getLogger(__name__)

def _get_staff_profile(user):
    return getattr(user, 'staff_profile', None)


def _get_user_department(user):
    profile = _get_staff_profile(user)
    return profile.department if profile else None


def _report_scope_users(user):
    queryset = User.objects.select_related('staff_profile__department').filter(is_active=True)
    if has_global_access(user):
        return queryset.filter(staff_profile__department__isnull=False).distinct()

    department = _get_user_department(user)
    if department is None:
        return User.objects.filter(id=user.id).select_related('staff_profile__department')

    return queryset.filter(staff_profile__department=department).distinct()


def _get_or_create_current_user_report(user, report_date):
    profile = _get_staff_profile(user)
    if profile is None or profile.department is None:
        raise ValueError('Department is required to create a daily report.')

    report, _ = DailyReport.objects.get_or_create(
        user=user,
        report_date=report_date,
        defaults={'department': profile.department},
    )
    return report


def _serialize_daily_report_detail(report):
    return DailyReportDetailSerializer(report).data


def _serialize_daily_report_summary(report):
    return DailyReportSummarySerializer(report).data


def _parse_report_date(value):

    if isinstance(value, datetime):
        return value.date()
    return datetime.strptime(str(value), '%Y-%m-%d').date()


class ReportsMonthCalendarView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        month_str = request.query_params.get('month')
        if not month_str:
            raise ValidationError('month query parameter is required')

        try:

            month_start = datetime.strptime(month_str, '%Y-%m').date().replace(day=1)
            next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
            month_end = next_month - timedelta(days=1)
        except Exception as exc:
            raise ValidationError(str(exc))

        scope_users = _report_scope_users(request.user)
        reports = DailyReport.objects.filter(
            report_date__gte=month_start,
            report_date__lte=month_end,
            user__in=scope_users,
        ).values('report_date').annotate(
            report_count=Count('id'),
            subreport_count=Count('subreports', distinct=True),
        ).order_by('report_date')

        your_reports = DailyReport.objects.filter(
            user=request.user,
            report_date__gte=month_start,
            report_date__lte=month_end,
        ).values('report_date').annotate(
            report_count=Count('id'),
            subreport_count=Count('subreports', distinct=True),
        ).order_by('report_date')

        report_map = {
            str(item['report_date']): item for item in reports
        }
        your_report_map = {
            str(item['report_date']): item for item in your_reports
        }

        return Response({
            'month': month_start.strftime('%Y-%m'),
            'dates': [
                {
                    'report_date': date_str,
                    'report_count': report_map.get(date_str, {}).get('report_count', 0),
                    'subreport_count': your_report_map.get(date_str, {}).get('subreport_count', 0),
                    'has_your_report': date_str in your_report_map,
                }
                for date_str in sorted(report_map.keys())
            ],
        })


class ReportsDayView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        report_date_str = request.query_params.get('report_date')
        if not report_date_str:
            raise ValidationError('report_date query parameter is required')

        try:
            report_date = _parse_report_date(report_date_str)
        except Exception as exc:
            raise ValidationError(str(exc))

        your_report = DailyReport.objects.select_related('user__staff_profile__department').prefetch_related(
            'subreports__comments__author',
            'subreports__created_by',
            'user__staff_profile__department',
        ).filter(user=request.user, report_date=report_date).first()

        scope_users = _report_scope_users(request.user)
        all_reports = DailyReport.objects.select_related('user__staff_profile__department').prefetch_related(
            'subreports',
            'user__staff_profile__department',
        ).filter(
            report_date=report_date,
            user__in=scope_users,
        ).annotate(subreport_count=Count('subreports', distinct=True)).order_by('user__first_name', 'user__last_name', 'user__username')

        return Response({
            'report_date': str(report_date),
            'your_report': _serialize_daily_report_detail(your_report) if your_report else None,
            'all_reports': DailyReportSummarySerializer(all_reports, many=True).data,
        })

    @transaction.atomic
    def post(self, request):
        serializer = DailyReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        report_date = serializer.validated_data['report_date']
        try:
            daily_report = _get_or_create_current_user_report(request.user, report_date)
        except ValueError as exc:
            raise ValidationError(str(exc))

        daily_report = DailyReport.objects.select_for_update().get(id=daily_report.id)

        subreport = DailyReportSubreport.objects.create(
            daily_report=daily_report,
            title=serializer.validated_data['title'],
            created_by=request.user,
        )
        DailyReportComment.objects.create(
            subreport=subreport,
            author=request.user,
            body=serializer.validated_data['comment'],
        )

        log_audit(
            action=AuditAction.DAILY_REPORT_CREATED,
            request=request,
            actor_user=request.user,
            target_type='daily_report_subreport',
            target_id=str(subreport.id),
            metadata={
                'report_date': str(report_date),
                'daily_report_id': str(daily_report.id),
                'title': subreport.title,
            },
        )

        _handle_first_subreport_notification(daily_report, request.user)

        return Response(DailyReportSubreportDetailSerializer(subreport).data, status=status.HTTP_201_CREATED)


class DepartmentReportsAllView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        scope_users = _report_scope_users(request.user)
        qs = DailyReport.objects.filter(user__in=scope_users)

        if not has_global_access(request.user):
            department = _get_user_department(request.user)
            if department is None:
                qs = qs.none()
            else:
                qs = qs.filter(department=department)
        else:
            department_id = uuid_param(request.query_params, 'department_id')
            if department_id:
                qs = qs.filter(department_id=department_id)

        date_str = request.query_params.get('date')
        if date_str:
            try:
                report_date = _parse_report_date(date_str)
                qs = qs.filter(report_date=report_date)
            except Exception as exc:
                raise ValidationError(f"Invalid date: {exc}")

        date_from_str = request.query_params.get('date_from')
        if date_from_str:
            try:
                date_from = _parse_report_date(date_from_str)
                qs = qs.filter(report_date__gte=date_from)
            except Exception as exc:
                raise ValidationError(f"Invalid date_from: {exc}")

        date_to_str = request.query_params.get('date_to')
        if date_to_str:
            try:
                date_to = _parse_report_date(date_to_str)
                qs = qs.filter(report_date__lte=date_to)
            except Exception as exc:
                raise ValidationError(f"Invalid date_to: {exc}")

        search_query = request.query_params.get('search') or request.query_params.get('user')
        if search_query:
            q = search_query.strip()
            if q:
                qs = qs.filter(
                    Q(user__username__icontains=q)
                    | Q(user__email__icontains=q)
                    | Q(user__first_name__icontains=q)
                    | Q(user__last_name__icontains=q)
                )

        distinct_dates = list(
            qs.order_by('-report_date')
            .values_list('report_date', flat=True)
            .distinct()
        )
        total_dates = len(distinct_dates)

        page_str = request.query_params.get('page', '1')
        try:
            page = int(page_str)
        except (TypeError, ValueError):
            page = 1

        if page < 1:
            page = 1

        total_reports = qs.count()

        if total_dates == 0 or page > total_dates:
            return Response({
                'current_date': None,
                'page': page,
                'total_pages': total_dates,
                'total_dates': total_dates,
                'total_reports': total_reports,
                'has_next': False,
                'next_page': None,
                'results': [],
            })

        target_date = distinct_dates[page - 1]
        reports_for_date = (
            qs.filter(report_date=target_date)
            .select_related('user__staff_profile__department', 'department')
            .prefetch_related(
                'subreports__comments__author',
                'subreports__created_by',
            )
            .annotate(subreport_count=Count('subreports', distinct=True))
            .order_by('user__first_name', 'user__last_name', 'user__username')
        )

        has_next = page < total_dates
        next_page = page + 1 if has_next else None

        return Response({
            'current_date': str(target_date),
            'page': page,
            'total_pages': total_dates,
            'total_dates': total_dates,
            'total_reports': total_reports,
            'has_next': has_next,
            'next_page': next_page,
            'results': DailyReportDetailSerializer(reports_for_date, many=True).data,
        })


class DailyReportDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_object(self, report_id):
        return DailyReport.objects.select_related('user__staff_profile__department').prefetch_related(
            'subreports__comments__author',
            'subreports__created_by',
            'user__staff_profile__department',
        ).get(id=report_id)

    def get(self, request, report_id):
        try:
            report = self.get_object(report_id)
        except DailyReport.DoesNotExist:
            raise NotFound('Report not found')

        if not has_global_access(request.user) and report.user_id != request.user.id:
            department = _get_user_department(request.user)
            if department is None or report.department_id != department.id:
                raise PermissionDenied('Forbidden')

        return Response(_serialize_daily_report_detail(report))


def _handle_first_subreport_notification(daily_report, user):
    """Trigger the manager notification email if this is the first report of the day for the user."""
    if daily_report.subreports.count() == 1:
        DailyReportEmailManager.send_manager_notification(daily_report, user)


class DailyReportSubreportCreateView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, report_id):
        serializer = DailyReportSubreportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            report = DailyReport.objects.get(id=report_id)
        except DailyReport.DoesNotExist:
            raise NotFound('Report not found')

        # Lock the report
        report = DailyReport.objects.select_for_update().get(id=report.id)

        if report.user_id != request.user.id and not has_global_access(request.user):
            raise PermissionDenied('Forbidden')

        if report.report_date != timezone.localdate():
            return Response(
                {'error': 'You can only add reports on the current day.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        subreport = DailyReportSubreport.objects.create(
            daily_report=report,
            title=serializer.validated_data['title'],
            created_by=request.user,
        )
        DailyReportComment.objects.create(
            subreport=subreport,
            author=request.user,
            body=serializer.validated_data['comment'],
        )

        _handle_first_subreport_notification(report, request.user)

        return Response(DailyReportSubreportDetailSerializer(subreport).data, status=status.HTTP_201_CREATED)


class DailyReportSubreportDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_object(self, subreport_id):
        return DailyReportSubreport.objects.select_related(
            'daily_report__user__staff_profile__department',
            'created_by__staff_profile__department',
        ).prefetch_related('comments__author').get(id=subreport_id)

    def get(self, request, subreport_id):
        try:
            subreport = self.get_object(subreport_id)
        except DailyReportSubreport.DoesNotExist:
            raise NotFound('Subreport not found')

        if not has_global_access(request.user) and subreport.daily_report.user_id != request.user.id:
            department = _get_user_department(request.user)
            if department is None or subreport.daily_report.department_id != department.id:
                raise PermissionDenied('Forbidden')

        return Response(DailyReportSubreportDetailSerializer(subreport).data)


class DailyReportSubreportCommentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, subreport_id):
        serializer = DailyReportCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            subreport = DailyReportSubreport.objects.select_related('daily_report__user').get(id=subreport_id)
        except DailyReportSubreport.DoesNotExist:
            raise NotFound('Subreport not found')

        if not has_global_access(request.user) and subreport.daily_report.user_id != request.user.id:
            raise PermissionDenied('Forbidden')

        if subreport.daily_report.report_date != timezone.localdate():
            return Response(
                {'error': 'You can only add comments on the current day.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        comment = DailyReportComment.objects.create(
            subreport=subreport,
            author=request.user,
            body=serializer.validated_data['body'],
        )

        return Response(DailyReportCommentSerializer(comment).data, status=status.HTTP_201_CREATED)


class DailyReportSendEmailView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'email'

    def get_report(self, report_id):
        return DailyReport.objects.select_related(
            'user',
            'department',
        ).prefetch_related(
            'subreports__comments__author',
            'subreports__created_by',
        ).get(id=report_id)

    def post(self, request, report_id):
        if not EmailConfig.is_enabled():
            return Response(
                {'error': 'Email sending is disabled.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            report = self.get_report(report_id)
        except DailyReport.DoesNotExist:
            raise NotFound('Report not found')

        if report.user_id != request.user.id:
            raise PermissionDenied('Forbidden')

        serializer = DailyReportSendEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        recipients = list(set(serializer.validated_data['recipients']))

        existing_users_count = User.objects.filter(email__in=recipients, is_active=True).count()
        if existing_users_count != len(recipients):
            return Response(
                {'error': 'One or more recipient email addresses are not registered active users.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        sent = DailyReportEmailManager.send_forward(
            report=report,
            sender=request.user,
            recipients=recipients,
        )
        if not sent:
            return Response(
                {'error': 'Failed to send email. Please try again later.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        recipient_count = len(recipients)
        detail = (
            f'Report forwarded to {recipient_count} recipient.'
            if recipient_count == 1
            else f'Report forwarded to {recipient_count} recipients.'
        )
        return Response({'detail': detail}, status=status.HTTP_200_OK)
