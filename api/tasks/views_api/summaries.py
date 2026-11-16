"""Weekly summaries, sharing, exports and the organization summary."""

import logging
import secrets
from collections import defaultdict
from datetime import datetime, timedelta

from django.contrib.auth.models import User
from django.db import IntegrityError, models, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from applications.audit import log_audit
from applications.audit_actions import AuditAction
from common.params import date_param, int_param
from common.permissions import has_global_access
from common.users import display_name
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
    SummaryWithComparisonSerializer,
    WeeklySummaryComparisonSerializer,
    WeeklySummarySerializer,
    WeeklySummaryUserShareSerializer,
)
from ..services import calculate_weekly_comparison

logger = logging.getLogger(__name__)

class WeeklySummaryViewSet(ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'])
    def available_weeks(self, request):
        """GET /summaries/available-weeks/ - List available summary weeks"""
        summaries = WeeklySummary.objects.filter(user=request.user).values(
            'week_start_date', 'week_end_date', 'created_at'
        ).order_by('-week_start_date')
        return Response(summaries)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """GET /summaries/summary/?week_start_date=YYYY-MM-DD"""
        week_start_date = date_param(request.query_params, 'week_start_date')
        if not week_start_date:
            return Response(
                {'error': 'week_start_date query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            summary = WeeklySummary.objects.get(
                user=request.user,
                week_start_date=week_start_date
            )
            serializer = WeeklySummarySerializer(summary)
            return Response(serializer.data)
        except WeeklySummary.DoesNotExist:
            return Response(
                {'error': 'Summary not found for the specified week'},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=False, methods=['get'])
    def comparison_metrics(self, request):
        """GET /summaries/comparison-metrics/?week_start_date=YYYY-MM-DD - Return stored comparison metrics for a summary"""
        week_start_date = date_param(request.query_params, 'week_start_date')
        if not week_start_date:
            return Response(
                {'error': 'week_start_date query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            summary = WeeklySummary.objects.get(
                user=request.user,
                week_start_date=week_start_date
            )
            comparison = summary.comparison_metrics or {}

            # If no stored comparison metrics, attempt on-demand calculation using previous week's summary
            if not comparison:
                prev_week = (week_start_date - timedelta(days=7))
                previous_summary = WeeklySummary.objects.filter(
                    user=request.user,
                    week_start_date=prev_week
                ).first()

                if previous_summary:
                    try:
                        calculated = calculate_weekly_comparison(
                            summary.summary_data,
                            previous_summary.summary_data
                        )
                        # persist for future requests
                        summary.previous_week_summary = previous_summary
                        summary.comparison_metrics = calculated
                        summary.save(update_fields=['previous_week_summary', 'comparison_metrics'])
                        comparison = calculated
                    except Exception:
                        logger.exception('Unexpected error calculating summary comparison')
                        raise ValidationError('An unexpected error occurred.')

            if not comparison:
                return Response({}, status=status.HTTP_200_OK)

            serializer = WeeklySummaryComparisonSerializer(comparison)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except WeeklySummary.DoesNotExist:
            return Response(
                {'error': 'Summary not found for the specified week'},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=False, methods=['get'])
    def historical(self, request):
        """GET /summaries/historical/?week_start_date=YYYY-MM-DD&weeks=4 - Return recent weekly summaries including the requested week"""
        week_start = date_param(request.query_params, 'week_start_date')
        weeks = int_param(request.query_params, 'weeks', default=4, minimum=1, maximum=52)
        if not week_start:
            return Response(
                {'error': 'week_start_date query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            week_starts = [(week_start - timedelta(days=7 * i)) for i in range(weeks)][::-1]

            summaries = WeeklySummary.objects.filter(
                user=request.user,
                week_start_date__in=week_starts
            ).order_by('week_start_date')

            serializer = WeeklySummarySerializer(summaries, many=True)
            return Response(serializer.data)
        except Exception:
            logger.exception('Unexpected error retrieving historical summaries')
            raise ValidationError('An unexpected error occurred.')

    @action(detail=False, methods=['post'])
    def share(self, request):
        """POST /summaries/share/ - Create a public share link"""
        week_start_date = date_param(request.data, 'week_start_date')
        if not week_start_date:
            return Response(
                {'error': 'week_start_date is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            summary = WeeklySummary.objects.get(
                user=request.user,
                week_start_date=week_start_date
            )
        except WeeklySummary.DoesNotExist:
            return Response(
                {'error': 'Summary not found for the specified week'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Generate secure token
        share_token = secrets.token_urlsafe(48)
        share = WeeklySummaryShare.objects.create(
            summary=summary,
            shared_by=request.user,
            share_token=share_token
        )

        log_audit(
            action=AuditAction.WEEKLY_SUMMARY_SHARED,
            request=request,
            target_type='weekly_summary',
            target_id=summary.id,
            # The token itself is a credential for the summary, so it is never
            # written to the audit log; the share's id identifies it instead.
            metadata={
                'share_id': str(share.id),
                'week_start_date': str(week_start_date),
            },
        )

        return Response({
            'share_link': f'/summaries?token={share_token}',
            'share_token': share_token,
            'created_at': share.created_at
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def share_status(self, request):
        """GET /summaries/share-status/?week_start_date=YYYY-MM-DD - returns public share info if any"""
        week_start_date = date_param(request.query_params, 'week_start_date')
        if not week_start_date:
            raise ValidationError('week_start_date is required')

        try:
            summary = WeeklySummary.objects.get(user=request.user, week_start_date=week_start_date)
        except WeeklySummary.DoesNotExist:
            raise NotFound('Summary not found')

        # Return the most recent public share if exists
        public_share = WeeklySummaryShare.objects.filter(summary=summary).order_by('-created_at').first()
        if not public_share:
            return Response({'shared': False})

        return Response({'shared': True, 'share_link': f'/summaries?token={public_share.share_token}', 'share_token': public_share.share_token})

    @action(detail=False, methods=['post'])
    def revoke_share(self, request):
        """POST /summaries/revoke_share/ - Revoke a public share for a summary"""
        week_start_date = date_param(request.data, 'week_start_date')
        if not week_start_date:
            raise ValidationError('week_start_date is required')

        try:
            summary = WeeklySummary.objects.get(user=request.user, week_start_date=week_start_date)
        except WeeklySummary.DoesNotExist:
            raise NotFound('Summary not found')

        # Only allow owner who created the share to revoke (shared_by == request.user)
        shares = WeeklySummaryShare.objects.filter(summary=summary)
        deleted = 0
        for s in shares:
            if s.shared_by == request.user:
                s.delete()
                deleted += 1

        return Response({'revoked': deleted > 0, 'revoked_count': deleted})

    @action(detail=False, methods=['get'])
    def user_shares(self, request):
        """GET /summaries/user-shares/?week_start_date=YYYY-MM-DD - list user-to-user shares for a summary"""
        week_start_date = date_param(request.query_params, 'week_start_date')
        if not week_start_date:
            raise ValidationError('week_start_date is required')

        try:
            summary = WeeklySummary.objects.get(user=request.user, week_start_date=week_start_date)
        except WeeklySummary.DoesNotExist:
            raise NotFound('Summary not found')

        shares = WeeklySummaryUserShare.objects.filter(summary=summary).select_related('shared_with')
        serializer = WeeklySummaryUserShareSerializer(shares, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def revoke_user_share(self, request):
        """POST /summaries/revoke-user-share/ - revoke a user-to-user share"""
        week_start_date = date_param(request.data, 'week_start_date')
        shared_with_id = int_param(request.data, 'user_id')
        if not week_start_date or not shared_with_id:
            raise ValidationError('week_start_date and user_id required')

        try:
            summary = WeeklySummary.objects.get(user=request.user, week_start_date=week_start_date)
        except WeeklySummary.DoesNotExist:
            raise NotFound('Summary not found')

        deleted = WeeklySummaryUserShare.objects.filter(summary=summary, shared_with__id=shared_with_id, shared_by=request.user).delete()
        # delete() returns (count, {..})
        count = deleted[0] if isinstance(deleted, tuple) else int(deleted)
        return Response({'revoked': count > 0, 'revoked_count': count})

    @action(detail=False, methods=['get'])
    def shared(self, request):
        """GET /summaries/shared/{share_token}/ - View shared summary for authenticated users"""
        share_token = request.query_params.get('token')
        if not share_token:
            return Response(
                {'error': 'share_token is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # First try public shares
        try:
            share = WeeklySummaryShare.objects.get(share_token=share_token)

            # Check if expired
            if share.expires_at and share.expires_at < timezone.now():
                return Response(
                    {'error': 'Share link has expired'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # Use SummaryWithComparisonSerializer so shared view includes comparison_metrics if present

            summary_serialized = SummaryWithComparisonSerializer(share.summary).data

            # Also include historical summaries (last 4 weeks including this one)
            try:
                week_start = share.summary.week_start_date
                if isinstance(week_start, str):
                    week_start = datetime.strptime(week_start, '%Y-%m-%d').date()

                week_starts = [(week_start - timedelta(days=7 * i)) for i in range(4)][::-1]
                historical_qs = WeeklySummary.objects.filter(
                    user=share.summary.user,
                    week_start_date__in=week_starts
                ).order_by('week_start_date')
                historical_serialized = WeeklySummarySerializer(historical_qs, many=True).data
            except Exception:
                historical_serialized = []

            return Response({
                'summary': summary_serialized,
                'historical': historical_serialized,
            })
        except WeeklySummaryShare.DoesNotExist:
            # Not a public share, check if it's a user-scoped share token
            try:
                user_share = WeeklySummaryUserShare.objects.get(share_token=share_token)

                # Require authentication and ensure the requesting user is the intended recipient
                if not request.user or not request.user.is_authenticated:
                    raise PermissionDenied('Authentication required for this share link')

                if user_share.shared_with != request.user:
                    raise PermissionDenied('This share link is not valid for your account')


                summary_serialized = SummaryWithComparisonSerializer(user_share.summary).data

                try:
                    week_start = user_share.summary.week_start_date
                    if isinstance(week_start, str):
                        week_start = datetime.strptime(week_start, '%Y-%m-%d').date()

                    week_starts = [(week_start - timedelta(days=7 * i)) for i in range(4)][::-1]
                    historical_qs = WeeklySummary.objects.filter(
                        user=user_share.summary.user,
                        week_start_date__in=week_starts
                    ).order_by('week_start_date')
                    historical_serialized = WeeklySummarySerializer(historical_qs, many=True).data
                except Exception:
                    historical_serialized = []

                return Response({
                    'summary': summary_serialized,
                    'historical': historical_serialized,
                })
            except WeeklySummaryUserShare.DoesNotExist:
                return Response(
                    {'error': 'Invalid share link'},
                    status=status.HTTP_404_NOT_FOUND
                )

    # Organization summary, sharing with a user, and export

    @action(detail=False, methods=['get'])
    def organization_summary(self, request):
        """GET /summaries/organization-summary/ - Org-wide stats (admin only)

        Checks the OrganizationSummaryCache first. Falls back to live
        aggregation if no cached entry exists for the requested week.
        """
        if not has_global_access(request.user):
            return Response(
                {'error': 'Admin access required'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        week_start = date_param(request.query_params, 'week_start_date')
        if not week_start:
            return Response(
                {'error': 'week_start_date parameter required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            week_end = week_start + timedelta(days=6)

            cached_entry = OrganizationSummaryCache.objects.filter(
                week_start_date=week_start
            ).first()

            if cached_entry is not None:
                serializer = OrganizationSummarySerializer(cached_entry.summary_data)
                return Response(serializer.data)

            # Fall back to live aggregation
            org_summary = task_services.calculate_organization_summary(week_start, week_end)
            
            serializer = OrganizationSummarySerializer(org_summary)
            return Response(serializer.data)
        except Exception:
            logger.exception('Unexpected error calculating organization summary')
            return Response(
                {'error': 'An unexpected error occurred.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


    
    @action(detail=False, methods=['post'])
    def share_with_user(self, request):
        """POST /summaries/share-with-user/ - Share with specific user"""
        week_start = date_param(request.data, 'week_start_date')
        shared_with_id = int_param(request.data, 'user_id')
        
        if not week_start or not shared_with_id:
            return Response(
                {'error': 'week_start_date and user_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            
            summary = WeeklySummary.objects.get(
                user=request.user,
                week_start_date=week_start
            )
            
            try:
                shared_with_user = User.objects.get(id=shared_with_id)
            except User.DoesNotExist:
                return Response(
                    {'error': 'User not found'},
                    status=status.HTTP_404_NOT_FOUND
                )
            
            
            # Avoid duplicate shares: return existing share if present

            existing = WeeklySummaryUserShare.objects.filter(
                summary=summary,
                shared_with=shared_with_user
            ).first()
            if existing:
                # Re-send email when a user re-shares with the same recipient.
                try:
                    existing_summary_path = f"/summaries?token={existing.share_token}" if existing.share_token else "/summaries"
                    SummaryEmailManager.send_summary_shared_notification(
                        shared_with_user,
                        request.user,
                        str(week_start),
                        view_summary_url=existing_summary_path,
                        week_end=str(summary.week_end_date),
                    )
                except Exception:
                    logger.exception('Failed to send summary shared email for existing share')

                serializer = WeeklySummaryUserShareSerializer(existing)
                return Response(serializer.data, status=status.HTTP_200_OK)

            try:
                with transaction.atomic():
                    # generate a per-user token for recipient-scoped access
                    share_token = secrets.token_urlsafe(48)
                    share = WeeklySummaryUserShare.objects.create(
                        summary=summary,
                        shared_by=request.user,
                        shared_with=shared_with_user,
                        share_token=share_token,
                    )
            except IntegrityError as ie:
                # Likely a concurrent duplicate insert
                existing = WeeklySummaryUserShare.objects.filter(
                    summary=summary,
                    shared_with=shared_with_user
                ).first()
                if existing:
                    serializer = WeeklySummaryUserShareSerializer(existing)
                    return Response(serializer.data, status=status.HTTP_200_OK)
                raise ie
            
            # Send notification email
            try:
                summary_path = f"/summaries?token={share.share_token}"
                SummaryEmailManager.send_summary_shared_notification(
                    shared_with_user,
                    request.user,
                    str(week_start),
                    view_summary_url=summary_path,
                    week_end=str(summary.week_end_date),
                )
            except Exception:
                logger.exception('Failed to send summary shared email')

            # Create in-app notification and attempt web-push delivery
            try:
                # Use the per-user share token in the link so the recipient can open it.
                # Use a relative frontend path so the client's service worker opens the frontend route.
                summary_path = f"/summaries?token={share.share_token}"

                create_notification(
                    shared_with_user,
                    actor=request.user,
                    notification_type=Notification.TYPE_SUMMARY_SHARED,
                    title=f"{request.user.username} shared a weekly summary",
                    body=f"{request.user.username} shared the summary for week starting {week_start} with you.",
                    link_url=summary_path,
                    payload={
                        'summary_id': str(summary.id),
                        'week_start_date': str(week_start),
                        'url': summary_path,
                    },
                    send_push=True,
                )
            except Exception:
                logger.exception('Failed to create notification for shared summary')
            
            serializer = WeeklySummaryUserShareSerializer(share)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except WeeklySummary.DoesNotExist:
            return Response(
                {'error': 'Summary not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception:
            logger.exception('Unexpected error in manual aggregate summary')
            return Response(
                {'error': 'An unexpected error occurred.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
    @action(detail=False, methods=['post'])
    def export(self, request):
        """POST /summaries/export/ - Export summary as PDF"""
        week_start = date_param(request.data, 'week_start_date')
        export_format = request.data.get('format', 'pdf')
        
        if not week_start or export_format != 'pdf':
            return Response(
                {'error': 'week_start_date and format "pdf" required (CSV export removed)'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            
            summary = WeeklySummary.objects.get(
                user=request.user,
                week_start_date=week_start
            )
            

            filename = f"summary_{summary.id}_{week_start}.pdf"

            file_bytes = generate_summary_pdf(
                summary.summary_data,
                request.user,
                summary.comparison_metrics
            )
            content_type = 'application/pdf'

            file_url = save_export_to_s3(file_bytes, filename, content_type)

            export_record = SummaryExport.objects.create(
                summary=summary,
                exported_by=request.user,
                format='pdf',
                file_url=file_url
            )

            serializer = SummaryExportSerializer(export_record)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except WeeklySummary.DoesNotExist:
            return Response(
                {'error': 'Summary not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception:
            logger.exception('Export failed while exporting summary')
            return Response(
                {'error': 'An unexpected error occurred during export.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class SummaryFilesViewSet(ViewSet):
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
                if share_token:
                    valid_public_share = WeeklySummaryShare.objects.filter(
                        summary=summary,
                        share_token=share_token,
                    ).filter(
                        models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=timezone.now())
                    ).exists()

                    valid_user_share = WeeklySummaryUserShare.objects.filter(
                        summary=summary,
                        share_token=share_token,
                        shared_with=request.user,
                    ).exists()

                    if not (valid_public_share or valid_user_share):
                        raise PermissionDenied('Forbidden')
                else:
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
                if activity.attachments.exists():
                    task = activity.task
                    for attachment in activity.attachments.all():
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
