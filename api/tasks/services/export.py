"""PDF export services for summaries."""
import io
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone

from tasks.s3 import _s3_client


def generate_summary_pdf(summary_data: dict, user: User, comparison_data: dict | None = None) -> bytes:
    """
    Generate PDF export of a summary using reportlab
    
    Note: Requires reportlab to be installed: pip install reportlab
    """
    try:
        from reportlab.lib.pagesizes import letter
        """Backward-compatible re-export of summary export helpers."""

        from tasks.export_storage import generate_summary_pdf, save_export_to_s3
        from reportlab.lib import colors
