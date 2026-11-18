"""Weekly summaries, sharing, exports and the organization summary."""

import hashlib
import logging
import secrets
from collections import defaultdict
from datetime import datetime, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import IntegrityError, models, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from audit import log_audit
from audit.actions import AuditAction
from common.exceptions import Gone
from common.params import date_param, int_param
from common.permissions import has_global_access
from common.users import display_name
from common.viewsets import GenericViewSet
from emails.services.summary_emails import SummaryEmailManager
from notifications.models import Notification
from notifications.services import create_notification
from tasks.export_storage import generate_summary_pdf, save_export_to_s3

from .. import services as task_services
from ..models import (
    OrganizationSummaryCache,
    SummaryExport,
    Task,
    TaskActivity,
    WeeklySummary,
    WeeklySummaryShare,
    WeeklySummaryUserShare,
)
from ..serializers import (
    OrganizationSummarySerializer,
    SummaryExportSerializer,
    SummaryUserShareCreateSerializer,
    SummaryWithComparisonSerializer,
    WeeklySummaryComparisonSerializer,
    WeeklySummarySerializer,
    WeeklySummaryUserShareSerializer,
)
from ..services import calculate_weekly_comparison

User = get_user_model()

logger = logging.getLogger(__name__)

SHARE_RESEND_SECONDS = 600


def hash_share_token(token):
    """Share tokens are credentials, so only their SHA-256 is stored. A copy of
    the database therefore cannot be used to open anyone's summary."""
    return hashlib.sha256(str(token).encode('utf-8')).hexdigest()


def _new_share_token():
    token = secrets.token_urlsafe(48)
    return token, hash_share_token(token)


def _share_link(token):
    return f'/summaries?token={token}'


def _own_summary(user, week):
    """The caller's own summary for the week starting on `week`."""
    summary = WeeklySummary.objects.filter(user=user, week_start_date=week).first()
    if summary is None:
        raise NotFound('Summary not found for the specified week')
    return summary


def _shared_payload(summary):
    week_starts = [summary.week_start_date - timedelta(days=7 * i) for i in range(4)]
    historical = WeeklySummary.objects.filter(
        user=summary.user,
        week_start_date__in=week_starts,
    ).order_by('week_start_date')
    return {
        'summary': SummaryWithComparisonSerializer(summary).data,
        'historical': WeeklySummarySerializer(historical, many=True).data,
    }


class WeeklySummaryViewSet(GenericViewSet):
    """A user's weekly summaries, addressed by the Monday the week starts on:
    /summaries/weeks/2026-11-09 and the sub-resources beneath it."""

    permission_classes = [IsAuthenticated]

    def weeks(self, request):
        """GET /summaries/weeks - the weeks the caller has a summary for."""
        summaries = WeeklySummary.objects.filter(user=request.user).values(
            'week_start_date', 'week_end_date', 'created_at'
        ).order_by('-week_start_date')
        return Response(summaries)

    def retrieve(self, request, week):
        """GET /summaries/weeks/{week}"""
        return Response(WeeklySummarySerializer(_own_summary(request.user, week)).data)

    def comparison(self, request, week):
        """GET /summaries/weeks/{week}/comparison - change against the week before."""
        summary = _own_summary(request.user, week)
        comparison = summary.comparison_metrics or {}

        if not comparison:
            previous_summary = WeeklySummary.objects.filter(
                user=request.user,
                week_start_date=week - timedelta(days=7),
            ).first()
            if previous_summary:
                comparison = calculate_weekly_comparison(summary.summary_data, previous_summary.summary_data)
                summary.previous_week_summary = previous_summary
                summary.comparison_metrics = comparison
                summary.save(update_fields=['previous_week_summary', 'comparison_metrics'])

        if not comparison:
            return Response({})
        return Response(WeeklySummaryComparisonSerializer(comparison).data)

    def history(self, request, week):
        """GET /summaries/weeks/{week}/history?weeks=4 - this week and the ones before it."""
        weeks = int_param(request.query_params, 'weeks', default=4, minimum=1, maximum=52)
        week_starts = [week - timedelta(days=7 * i) for i in range(weeks)]
        summaries = WeeklySummary.objects.filter(
            user=request.user,
            week_start_date__in=week_starts,
        ).order_by('week_start_date')
        return Response(WeeklySummarySerializer(summaries, many=True).data)

    # --- public share link -------------------------------------------------

    def share_status(self, request, week):
        """GET /summaries/weeks/{week}/share - whether a public link exists.

        The link itself is only ever shown once, when it is created.
        """
        summary = _own_summary(request.user, week)
        share = (
            WeeklySummaryShare.objects.filter(summary=summary)
            .filter(models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=timezone.now()))
            .order_by('-created_at')
            .first()
        )
        if share is None:
            return Response({'shared': False})
        return Response({'shared': True, 'created_at': share.created_at, 'expires_at': share.expires_at})

    def share_create(self, request, week):
        """POST /summaries/weeks/{week}/share - create the public link.

        A summary has one public link at a time: creating a new one replaces
        (and so revokes) the previous one.
        """
        summary = _own_summary(request.user, week)
        token, token_hash = _new_share_token()

        with transaction.atomic():
            WeeklySummaryShare.objects.filter(summary=summary).delete()
            share = WeeklySummaryShare.objects.create(
                summary=summary,
                shared_by=request.user,
                share_token=token_hash,
                expires_at=timezone.now() + timedelta(days=settings.SUMMARY_SHARE_LINK_DAYS),
            )

        log_audit(
            action=AuditAction.WEEKLY_SUMMARY_SHARED,
            request=request,
            target_type='weekly_summary',
            target_id=summary.id,
            # The token is a credential for the summary, so it is never written
            # to the audit log; the share's id identifies it instead.
            metadata={'share_id': str(share.id), 'week_start_date': str(week)},
        )

        return Response(
            {
                'share_link': _share_link(token),
                'created_at': share.created_at,
                'expires_at': share.expires_at,
            },
            status=status.HTTP_201_CREATED,
        )

    def share_revoke(self, request, week):
        """DELETE /summaries/weeks/{week}/share"""
        summary = _own_summary(request.user, week)
        WeeklySummaryShare.objects.filter(summary=summary).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # --- sharing with a named colleague ------------------------------------

    def user_shares(self, request, week):
        """GET /summaries/weeks/{week}/user-shares"""
        summary = _own_summary(request.user, week)
        shares = WeeklySummaryUserShare.objects.filter(summary=summary).select_related('shared_with')
        return Response(WeeklySummaryUserShareSerializer(shares, many=True).data)

    def user_share_create(self, request, week):
        """POST /summaries/weeks/{week}/user-shares {user_id} - share with one colleague.

        The colleague gets an email and a notification carrying their personal
        link. Sharing again with the same person issues a fresh link, at most
        once every ten minutes, so the endpoint cannot be used to flood them.
        """
        serializer = SummaryUserShareCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        summary = _own_summary(request.user, week)

        recipient = User.objects.filter(id=serializer.validated_data['user_id'], is_active=True).first()
        if recipient is None:
            raise NotFound('User not found')
        if recipient.pk == request.user.pk:
            raise ValidationError({'user_id': 'You cannot share a summary with yourself.'})

        resend_key = f'summary_share_sent:{summary.id}:{recipient.pk}'
        existing = WeeklySummaryUserShare.objects.filter(summary=summary, shared_with=recipient).first()
        if existing and cache.get(resend_key):
            return Response(WeeklySummaryUserShareSerializer(existing).data)

        token, token_hash = _new_share_token()
        created = existing is None
        try:
            with transaction.atomic():
                share, created = WeeklySummaryUserShare.objects.update_or_create(
                    summary=summary,
                    shared_with=recipient,
                    defaults={'shared_by': request.user, 'share_token': token_hash},
                )
        except IntegrityError:
            # Two identical requests at once: the other one created the share.
            share = WeeklySummaryUserShare.objects.get(summary=summary, shared_with=recipient)
            return Response(WeeklySummaryUserShareSerializer(share).data)

        cache.set(resend_key, True, SHARE_RESEND_SECONDS)
        summary_path = _share_link(token)

        try:
            SummaryEmailManager.send_summary_shared_notification(
                recipient,
                request.user,
                str(week),
                view_summary_url=summary_path,
                week_end=str(summary.week_end_date),
            )
        except Exception:
            logger.exception('Failed to send summary shared email')

        try:
            create_notification(
                recipient,
                actor=request.user,
                notification_type=Notification.TYPE_SUMMARY_SHARED,
                title=f"{request.user.username} shared a weekly summary",
                body=f"{request.user.username} shared the summary for week starting {week} with you.",
                link_url=summary_path,
                payload={
                    'summary_id': str(summary.id),
                    'week_start_date': str(week),
                    'url': summary_path,
                },
                send_push=True,
            )
        except Exception:
            logger.exception('Failed to create notification for shared summary')

        data = dict(WeeklySummaryUserShareSerializer(share).data)
        data['share_link'] = summary_path
        return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def user_share_revoke(self, request, week, user_id):
        """DELETE /summaries/weeks/{week}/user-shares/{user_id}"""
        summary = _own_summary(request.user, week)
        deleted, _details = WeeklySummaryUserShare.objects.filter(summary=summary, shared_with_id=user_id).delete()
        if not deleted:
            raise NotFound('This summary is not shared with that user.')
        return Response(status=status.HTTP_204_NO_CONTENT)

    # --- export ------------------------------------------------------------

    def export(self, request, week):
        """POST /summaries/weeks/{week}/export - generate and store a PDF."""
        summary = _own_summary(request.user, week)

        file_bytes = generate_summary_pdf(summary.summary_data, request.user, summary.comparison_metrics)
        file_url = save_export_to_s3(file_bytes, f"summary_{summary.id}_{week}.pdf", 'application/pdf')

        export_record = SummaryExport.objects.create(
            summary=summary,
            exported_by=request.user,
            format='pdf',
            file_url=file_url,
        )
        return Response(SummaryExportSerializer(export_record).data, status=status.HTTP_201_CREATED)

    # --- opening a shared summary -------------------------------------------

    def shared(self, request, token):
        """GET /summaries/shared/{token} - open a summary someone shared.

        A public link works for any signed-in user until it expires. A personal
        link works only for the colleague it was issued to.
        """
        token_hash = hash_share_token(token)

        share = WeeklySummaryShare.objects.filter(share_token=token_hash).select_related('summary__user').first()
        if share is not None:
            if share.expires_at and share.expires_at < timezone.now():
                raise Gone('This share link has expired.')
            return Response(_shared_payload(share.summary))

        user_share = (
            WeeklySummaryUserShare.objects.filter(share_token=token_hash).select_related('summary__user').first()
        )
        if user_share is None:
            raise NotFound('Invalid share link')
        if user_share.shared_with_id != request.user.id:
            raise PermissionDenied('This share link is not valid for your account')
        return Response(_shared_payload(user_share.summary))

    # --- organization-wide ---------------------------------------------------

    def organization(self, request):
        """GET /summaries/organization?week_start_date=YYYY-MM-DD - executives only.

        Uses the cached weekly figures when present, otherwise aggregates live.
        """
        if not has_global_access(request.user):
            raise PermissionDenied('Executive access required')

        week_start = date_param(request.query_params, 'week_start_date')
        if not week_start:
            raise ValidationError({'week_start_date': 'This parameter is required.'})

        cached_entry = OrganizationSummaryCache.objects.filter(week_start_date=week_start).first()
        if cached_entry is not None:
            return Response(OrganizationSummarySerializer(cached_entry.summary_data).data)

        org_summary = task_services.calculate_organization_summary(week_start, week_start + timedelta(days=6))
        return Response(OrganizationSummarySerializer(org_summary).data)


class SummaryFilesViewSet(GenericViewSet):
    """Nested viewset for files within a summary: GET /summaries/<id>/files/"""
    
    permission_classes = [IsAuthenticated]
    
    def list(self, request, summary_pk=None):
        """GET /summaries/<id>/files/?view=sent|received
        Returns all files attached during a week, grouped by task.
        - view=sent: files attached by the current user
        - view=received: files attached by others on tasks the user is involved with
        """
        view_type = request.query_params.get('view', 'sent')  # 'sent' or 'received'
        
        if view_type not in ['sent', 'received']:
            raise ValidationError('view parameter must be "sent" or "received"')
        
        try:
            summary = WeeklySummary.objects.get(id=summary_pk)
            
            # Check authorization - user must own the summary or have a valid share token
            if summary.user_id != request.user.id:
                share_token = request.query_params.get('token')
                # Allow if token matches either:
                # 1) a non-expired public share token, or
                # 2) a user-scoped share token issued specifically to this user
                if not share_token:
                    raise PermissionDenied('Forbidden')

                token_hash = hash_share_token(share_token)
                valid_public_share = WeeklySummaryShare.objects.filter(
                    summary=summary,
                    share_token=token_hash,
                ).filter(
                    models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=timezone.now())
                ).exists()
                valid_user_share = WeeklySummaryUserShare.objects.filter(
                    summary=summary,
                    share_token=token_hash,
                    shared_with=request.user,
                ).exists()
                if not (valid_public_share or valid_user_share):
                    raise PermissionDenied('Forbidden')

            week_start = summary.week_start_date
            week_end = summary.week_end_date
            
            if isinstance(week_start, str):
                week_start = datetime.strptime(week_start, '%Y-%m-%d').date()
            if isinstance(week_end, str):
                week_end = datetime.strptime(week_end, '%Y-%m-%d').date()
            
            # Add one day to week_end to make it inclusive
            week_end = week_end + timedelta(days=1)
            
            # Always scope file aggregation to the summary owner so shared viewers
            # see the same files represented by the shared summary metrics.
            summary_user = summary.user

            # Get all tasks involving the summary owner
            tasks_qs = Task.objects.filter(
                models.Q(assigned_to=summary_user) | models.Q(assigned_by=summary_user)
            ).distinct()
            
            # Find all activities with attachments during the week
            if view_type == 'sent':
                # Files attached by the summary owner
                activities_qs = TaskActivity.objects.filter(
                    task__in=tasks_qs,
                    user=summary_user,
                    created_at__gte=week_start,
                    created_at__lt=week_end
                ).prefetch_related('attachments', 'task').order_by('-created_at')
            else:  # received
                # Files attached by others on tasks involving the summary owner
                activities_qs = TaskActivity.objects.filter(
                    task__in=tasks_qs,
                    created_at__gte=week_start,
                    created_at__lt=week_end
                ).exclude(user=summary_user).prefetch_related('attachments', 'task').order_by('-created_at')
            
            # Group by task
            tasks_with_files = defaultdict(list)
            
            for activity in activities_qs:
                attachments = list(activity.attachments.all())
                if attachments:
                    task = activity.task
                    for attachment in attachments:
                        tasks_with_files[task.id].append({
                            'task_id': str(task.id),
                            'task_title': task.title,
                            'task_created_at': task.created_at.isoformat() if task.created_at else None,
                            'file_id': str(attachment.id),
                            'file_name': attachment.file_name,
                            'size': attachment.size,
                            'content_type': attachment.content_type,
                            'created_at': activity.created_at.isoformat(),
                            'created_by': display_name(activity.user),
                            'download_url': f'/api/attachments/{attachment.id}/download/',
                        })
            
            # Convert defaultdict to regular dict with sorted tasks
            result = {
                'week_start': summary.week_start_date.isoformat() if isinstance(summary.week_start_date, datetime) else summary.week_start_date,
                'week_end': summary.week_end_date.isoformat() if isinstance(summary.week_end_date, datetime) else summary.week_end_date,
                'view_type': view_type,
                'tasks': [
                    {
                        'task_id': task_id,
                        'task_title': tasks_with_files[task_id][0]['task_title'],
                        'task_created_at': tasks_with_files[task_id][0]['task_created_at'],
                        'files': tasks_with_files[task_id]
                    }
                    for task_id in sorted(tasks_with_files.keys(), 
                                        key=lambda tid: tasks_with_files[tid][0]['task_title'])
                ]
            }
            
            return Response(result)
        except WeeklySummary.DoesNotExist:
            raise NotFound('Summary not found')
