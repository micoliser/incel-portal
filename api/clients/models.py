"""Credit clients: companies the business lets take services on credit, up to a limit.

Available balance is never stored: it is always credit limit minus credit
utilization (`CreditClient.available_balance`). Repayments are not recorded yet.
"""

import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models.functions import Lower

from common.models import CreatedAtModel, TimeStampedModel


class Currency(models.TextChoices):
    NGN = 'NGN', 'Naira (NGN)'
    USD = 'USD', 'US Dollar (USD)'
    AED = 'AED', 'UAE Dirham (AED)'
    GBP = 'GBP', 'Pound Sterling (GBP)'
    EUR = 'EUR', 'Euro (EUR)'


MONEY = {'max_digits': 18, 'decimal_places': 2}


class CreditClient(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'Active'
        INACTIVE = 'inactive', 'Inactive'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    # Stored without spaces (clients.validation.clean_tin), so uniqueness ignores spacing.
    tin = models.CharField('TIN', max_length=20)
    # Contact person, phone and email are required by the form and the import
    # (clients.validation); the columns allow blank only for rows saved before that.
    contact_person = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(max_length=254, blank=True)
    address = models.TextField(max_length=500, blank=True)
    credit_limit = models.DecimalField(**MONEY, validators=[MinValueValidator(Decimal('0.01'))])
    credit_days = models.PositiveIntegerField()
    credit_utilization = models.DecimalField(**MONEY, default=Decimal('0'), validators=[MinValueValidator(Decimal('0'))])
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.NGN)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    notes = models.TextField(max_length=2000, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(Lower('name'), name='credit_client_name_unique_ci'),
            models.UniqueConstraint('tin', name='credit_client_tin_unique'),
            models.CheckConstraint(condition=models.Q(credit_limit__gt=0), name='credit_client_limit_positive'),
            models.CheckConstraint(condition=models.Q(credit_utilization__gte=0), name='credit_client_utilization_not_negative'),
        ]

    def __str__(self):
        return self.name

    @property
    def available_balance(self):
        return self.credit_limit - self.credit_utilization


class CreditClientChange(CreatedAtModel):
    """One change to a client: who made it, how (by hand or by an import), and old and new values."""

    class Source(models.TextChoices):
        CREATED = 'created', 'Created'
        EDITED = 'edited', 'Edited'
        IMPORTED = 'imported', 'Imported'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey(CreditClient, on_delete=models.CASCADE, related_name='changes')
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )
    source = models.CharField(max_length=10, choices=Source.choices)
    client_import = models.ForeignKey(
        'CreditClientImport', on_delete=models.SET_NULL, null=True, blank=True, related_name='changes',
    )
    # {field: [old, new]} with values as text; empty for a newly created client.
    changes = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-created_at']


class CreditClientImport(CreatedAtModel):
    """A confirmed spreadsheet import (previews are not recorded)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )
    file_name = models.CharField(max_length=255)
    rows = models.PositiveIntegerField(default=0)
    created_count = models.PositiveIntegerField(default=0)
    updated_count = models.PositiveIntegerField(default=0)
    rejected_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['-created_at']
