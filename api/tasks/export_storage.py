"""PDF export storage helpers for weekly summaries."""

import io

from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone

from tasks.s3 import _s3_client


def generate_summary_pdf(summary_data: dict, user: User, comparison_data: dict | None = None) -> bytes:
    """
    Generate PDF export of a summary using reportlab.

    Note: Requires reportlab to be installed.
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError:
        raise ImportError('reportlab is required for PDF export. Install with: pip install reportlab')

    pdf_buffer = io.BytesIO()
    doc = SimpleDocTemplate(pdf_buffer, pagesize=letter)
    story = []
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1e40af'),
        spaceAfter=30,
        alignment=1,
    )
    story.append(Paragraph('Weekly Summary Report', title_style))
    story.append(Spacer(1, 0.2 * inch))

    header_data = [
        ['User', user.get_full_name() or user.username],
        ['Week', f"{summary_data['week_start_date']} to {summary_data['week_end_date']}"],
        ['Generated', timezone.now().strftime('%Y-%m-%d %H:%M:%S')],
    ]
    header_table = Table(header_data, colWidths=[2 * inch, 4 * inch])
    header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#e5e7eb')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('GRID', (0, 0), (-1, -1), 1, colors.grey),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 0.3 * inch))

    story.append(Paragraph('Task Metrics', styles['Heading2']))
    metrics_data = [
        ['Metric', 'Value'],
        ['Tasks Created', str(summary_data.get('tasks_created', 0))],
        ['Tasks Assigned', str(summary_data.get('tasks_assigned', 0))],
        ['Tasks Completed', str(summary_data.get('tasks_completed', 0))],
        ['Completion Rate (%)', f"{summary_data.get('completion_rate_percent', 0):.1f}%"],
        ['On-Time Completion Rate (%)', f"{summary_data.get('on_time_completion_rate_percent', 0):.1f}%"],
    ]
    metrics_table = Table(metrics_data, colWidths=[3 * inch, 3 * inch])
    metrics_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3b82f6')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 11),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f3f4f6')),
        ('GRID', (0, 0), (-1, -1), 1, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f3f4f6')]),
    ]))
    story.append(metrics_table)
    story.append(Spacer(1, 0.3 * inch))

    if comparison_data:
        story.append(Paragraph('Week-over-Week Comparison', styles['Heading2']))
        comparison_table_data = [
            ['Metric', 'Change', 'Trend'],
            ['Completion Rate', f"{comparison_data.get('delta_completion_rate', 0):+.1f}%", comparison_data.get('trend', 'flat')],
            ['Tasks Completed', f"{comparison_data.get('delta_tasks_completed', 0):+d}", comparison_data.get('trend', 'flat')],
            ['On-Time Rate', f"{comparison_data.get('delta_on_time_completion_rate', 0):+.1f}%", comparison_data.get('trend', 'flat')],
        ]
        comparison_table = Table(comparison_table_data, colWidths=[3 * inch, 2 * inch, 1 * inch])
        comparison_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#10b981')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 1, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f3f4f6')]),
        ]))
        story.append(comparison_table)
        story.append(Spacer(1, 0.3 * inch))

    story.append(Paragraph('Engagement Metrics', styles['Heading2']))
    engagement_data = [
        ['Metric', 'Value'],
        ['Comments Added', str(summary_data.get('comments_added', 0))],
        ['Files Attached', str(summary_data.get('files_attached', 0))],
        ['Recurring Schedules', str(summary_data.get('recurring_schedules_created', 0))],
    ]
    engagement_table = Table(engagement_data, colWidths=[3 * inch, 3 * inch])
    engagement_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#8b5cf6')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 1, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f3f4f6')]),
    ]))
    story.append(engagement_table)

    doc.build(story)
    return pdf_buffer.getvalue()


def save_export_to_s3(file_bytes: bytes, filename: str, content_type: str) -> str:
    """Save export file to S3 and return a presigned URL."""
    bucket = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
    if not bucket:
        raise RuntimeError('AWS_S3_BUCKET_NAME is not configured.')

    key = f'summaries/{filename}'
    client = _s3_client()

    try:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=file_bytes,
            ContentType=content_type,
        )
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError('Failed to upload summary export to S3.') from exc

    return client.generate_presigned_url(
        'get_object',
        Params={'Bucket': bucket, 'Key': key},
        ExpiresIn=604800,
    )