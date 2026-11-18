import random
import string
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from common.models import CreatedAtModel, TimeStampedModel


class InventoryCategory(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class InventoryItem(TimeStampedModel):
    class Status(models.TextChoices):
        AVAILABLE = 'available', 'Available'
        ASSIGNED = 'assigned', 'Assigned'
        MAINTENANCE = 'maintenance', 'Maintenance'
        RETIRED = 'retired', 'Retired'
        UNACCOUNTED = 'unaccounted', 'Unaccounted'

    STATUS_CHOICES = Status.choices

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=6, unique=True, null=True, blank=True)
    category = models.ForeignKey(InventoryCategory, on_delete=models.PROTECT, related_name='items')
    serial_number = models.CharField(max_length=255, blank=True)
    purchase_date = models.DateField(null=True, blank=True)
    photo_url = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='available')
    status_reason = models.TextField(blank=True)
    quantity = models.PositiveIntegerField(default=1)
    
    current_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='assigned_inventory_items'
    )
    current_assignee_department = models.ForeignKey(
        'organization.Department',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_inventory_items'
    )
    managing_department = models.ForeignKey(
        'organization.Department',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='managed_inventory_items'
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['current_assignee']),
            models.Index(fields=['current_assignee_department']),
            models.Index(fields=['category', 'status']),
            models.Index(fields=['managing_department']),
        ]

    def clean(self):
        if self.current_assignee and self.current_assignee_department:
            raise ValidationError("An item cannot be assigned to both a user and a department simultaneously.")

    def __str__(self):
        return f"{self.name} ({self.code})" if self.code else self.name

    def save(self, *args, **kwargs):
        if not self.code:
            while True:
                code = ''.join(random.choices(string.digits, k=6))
                if not InventoryItem.objects.filter(code=code).exists():
                    self.code = code
                    break
        super().save(*args, **kwargs)


class InventoryAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(InventoryItem, on_delete=models.CASCADE, related_name='assignments')
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='inventory_assignment_history', null=True, blank=True)
    assigned_to_department = models.ForeignKey('organization.Department', on_delete=models.CASCADE, related_name='inventory_assignment_history', null=True, blank=True)
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='inventory_assignments_made')
    assigned_at = models.DateTimeField(default=timezone.now)
    returned_at = models.DateTimeField(null=True, blank=True)
    condition_notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-assigned_at']
        indexes = [
            models.Index(fields=['item', '-assigned_at']),
            models.Index(fields=['assigned_to', '-assigned_at']),
            models.Index(fields=['assigned_to_department', '-assigned_at']),
        ]

    def clean(self):
        if self.assigned_to and self.assigned_to_department:
            raise ValidationError("An assignment cannot be to both a user and a department.")
        if not self.assigned_to and not self.assigned_to_department:
            raise ValidationError("An assignment must be to either a user or a department.")

    def __str__(self):
        assignee = self.assigned_to.username if self.assigned_to else (self.assigned_to_department.name if self.assigned_to_department else "Unknown")
        return f"{self.item} assigned to {assignee}"


class InventoryMaintenanceLog(TimeStampedModel):
    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        IN_PROGRESS = 'in_progress', 'In Progress'
        COMPLETED = 'completed', 'Completed'

    STATUS_CHOICES = Status.choices

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(InventoryItem, on_delete=models.CASCADE, related_name='maintenance_logs')
    date = models.DateField(default=timezone.now)
    issue_reported = models.TextField()
    action_taken = models.TextField(blank=True)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_maintenance_logs')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='created_maintenance_logs')

    class Meta:
        ordering = ['-date', '-created_at']
        indexes = [
            models.Index(fields=['item', '-date']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f"Maintenance for {self.item} on {self.date}"

class MaintenanceLogAttachment(CreatedAtModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    log = models.ForeignKey(
        InventoryMaintenanceLog,
        on_delete=models.CASCADE,
        related_name='attachments'
    )
    object_key = models.CharField(max_length=1024, unique=True)
    file_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=255)
    size = models.PositiveBigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return self.file_name
