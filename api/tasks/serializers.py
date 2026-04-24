from rest_framework import serializers
from django.contrib.auth.models import User
from django.utils import timezone
from .models import Task, TaskActivity


class UserSimpleSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source='get_full_name', read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'full_name', 'email']


class TaskActivitySerializer(serializers.ModelSerializer):
    user = UserSimpleSerializer(read_only=True)

    class Meta:
        model = TaskActivity
        fields = ['id', 'task', 'user', 'activity_type', 'old_value', 'new_value', 'comment', 'created_at']
        read_only_fields = ['user', 'created_at', 'task']


class TaskSerializer(serializers.ModelSerializer):
    assigned_by = UserSimpleSerializer(read_only=True)
    assigned_to = UserSimpleSerializer(read_only=True)
    assigned_by_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), write_only=True, source='assigned_by', required=False
    )
    assigned_to_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), write_only=True, source='assigned_to'
    )

    class Meta:
        model = Task
        fields = [
            'id',
            'title',
            'description',
            'assigned_by',
            'assigned_by_id',
            'assigned_to',
            'assigned_to_id',
            'status',
            'priority',
            'deadline',
            'created_at',
            'updated_at',
            'completed_at',
        ]
        read_only_fields = ['created_at', 'updated_at', 'completed_at', 'assigned_by']

    def validate(self, attrs):
        request = self.context.get('request')
        current_user = getattr(request, 'user', None)
        deadline = attrs.get('deadline')

        if not self.instance and deadline is None:
            raise serializers.ValidationError(
                {'deadline': 'Deadline is required.'}
            )

        if deadline is not None:
            now = timezone.now().replace(second=0, microsecond=0)
            if deadline < now:
                raise serializers.ValidationError(
                    {'deadline': 'Deadline cannot be in the past.'}
                )

        assigned_to = attrs.get('assigned_to')
        if assigned_to is not None and current_user and assigned_to == current_user:
            raise serializers.ValidationError(
                {'assigned_to_id': 'You cannot assign a task to yourself.'}
            )

        if not self.instance:
            return attrs

        new_status = attrs.get('status')
        if new_status is None:
            return attrs

        old_status = self.instance.status
        if new_status == old_status:
            return attrs

        if current_user and current_user != self.instance.assigned_to:
            raise serializers.ValidationError(
                {'status': 'Only the assignee can change task progress.'}
            )

        if new_status == 'pending' and old_status != 'pending':
            raise serializers.ValidationError(
                {'status': 'Task progress cannot move back to pending once started.'}
            )

        return attrs
