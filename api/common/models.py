from django.db import models


class CreatedAtModel(models.Model):
    """For rows written once and never edited (history, logs, attachments, shares)."""

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True


class TimeStampedModel(CreatedAtModel):
    """For rows that change after they are created."""

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
