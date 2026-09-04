import uuid
import random
import string
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from common.models import TimeStampedModel


class InventoryCategory(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, unique=True)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class InventoryItem(TimeStampedModel):
    STATUS_CHOICES = [
        ('available', 'Available'),
        ('assigned', 'Assigned'),
        ('maintenance', 'Maintenance'),
        ('retired', 'Retired'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=6, unique=True, null=True, blank=True)
    category = models.ForeignKey(InventoryCategory, on_delete=models.PROTECT, related_name='items')
    serial_number = models.CharField(max_length=255, blank=True)
    purchase_date = models.DateField(null=True, blank=True)
    photo_url = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='available')
    
    current_assignee = models.ForeignKey(
        User, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True, 
        related_name='assigned_inventory_items'
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['current_assignee']),
            models.Index(fields=['category', 'status']),
        ]

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
    assigned_to = models.ForeignKey(User, on_delete=models.CASCADE, related_name='inventory_assignment_history')
    assigned_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='inventory_assignments_made')
    assigned_at = models.DateTimeField(default=timezone.now)
    returned_at = models.DateTimeField(null=True, blank=True)
    condition_notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-assigned_at']
        indexes = [
            models.Index(fields=['item', '-assigned_at']),
            models.Index(fields=['assigned_to', '-assigned_at']),
        ]

    def __str__(self):
        return f"{self.item} assigned to {self.assigned_to.username}"


class InventoryMaintenanceLog(TimeStampedModel):
    STATUS_CHOICES = [
        ('open', 'Open'),
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(InventoryItem, on_delete=models.CASCADE, related_name='maintenance_logs')
    date = models.DateField(default=timezone.now)
    issue_reported = models.TextField()
    action_taken = models.TextField(blank=True)
    assigned_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_maintenance_logs')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_maintenance_logs')

    class Meta:
        ordering = ['-date', '-created_at']
        indexes = [
            models.Index(fields=['item', '-date']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f"Maintenance for {self.item} on {self.date}"

class MaintenanceLogAttachment(models.Model):
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
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return self.file_name
