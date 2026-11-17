"""Personal to-dos."""

import logging

from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from common.pagination import page_size

from ..models import (
    TodoItem,
)
from ..serializers import TodoItemSerializer, TodoSnoozeSerializer

logger = logging.getLogger(__name__)

MAX_SNOOZE_MINUTES = 60 * 24 * 365


class TodoItemViewSet(ModelViewSet):
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']
    lookup_value_converter = 'uuid'
    serializer_class = TodoItemSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = page_size(25)

    def get_queryset(self):
        qs = TodoItem.objects.filter(user=self.request.user)
        view = self.request.query_params.get('view')
        now = timezone.now()
        today = timezone.localdate(now)

        if view == 'today':
            qs = qs.filter(
                Q(due_date=today) |
                Q(completed_at__date=today) |
                (Q(is_completed=False) & Q(due_datetime__lt=now))
            ).distinct()
        elif view == 'upcoming':
            qs = qs.filter(due_date__gt=today, is_completed=False)
        elif view == 'overdue':
            qs = qs.filter(due_datetime__lt=now, is_completed=False)
        elif view == 'completed':
            qs = qs.filter(is_completed=True)

        priority = self.request.query_params.get('priority')
        if priority in ['low', 'medium', 'high']:
            qs = qs.filter(priority=priority)

        search = self.request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(description__icontains=search))

        is_completed_param = self.request.query_params.get('is_completed')
        if is_completed_param is not None:
            if is_completed_param.lower() in ('true', '1'):
                qs = qs.filter(is_completed=True)
            elif is_completed_param.lower() in ('false', '0'):
                qs = qs.filter(is_completed=False)

        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=True, methods=['post'], url_path='toggle-complete')
    def toggle_complete(self, request, pk=None):
        todo = self.get_object()
        todo.toggle_complete()
        return Response(self.get_serializer(todo).data)

    @action(detail=True, methods=['post'], url_path='snooze')
    def snooze(self, request, pk=None):
        todo = self.get_object()
        serializer = TodoSnoozeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # At most a year: an unbounded value would overflow the date arithmetic.
        minutes = min(serializer.validated_data['minutes'], MAX_SNOOZE_MINUTES)
        todo.snooze(minutes=minutes)
        return Response(self.get_serializer(todo).data)

    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        qs = TodoItem.objects.filter(user=request.user)
        now = timezone.now()
        today = timezone.localdate(now)

        total = qs.count()
        completed = qs.filter(is_completed=True).count()
        overdue = qs.filter(is_completed=False, due_datetime__lt=now).count()
        today_count = qs.filter(
            Q(due_date=today) |
            Q(completed_at__date=today) |
            (Q(is_completed=False) & Q(due_datetime__lt=now))
        ).distinct().count()
        upcoming = qs.filter(due_date__gt=today, is_completed=False).count()

        return Response({
            'total': total,
            'today': today_count,
            'upcoming': upcoming,
            'overdue': overdue,
            'completed': completed,
        })

    @action(detail=False, methods=['post'], url_path='clear-completed')
    def clear_completed(self, request):
        deleted_count, _ = TodoItem.objects.filter(user=request.user, is_completed=True).delete()
        return Response({'count': deleted_count})
