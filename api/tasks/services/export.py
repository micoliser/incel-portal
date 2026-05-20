"""
PDF and CSV export services for summaries
"""
import io
import csv
from datetime import datetime
from django.contrib.auth.models import User
from django.utils import timezone


def generate_summary_csv(summary_data: dict, user: User) -> io.StringIO:
    """Generate CSV export of a summary"""
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Header
    writer.writerow(['Weekly Summary Report', ''])
    writer.writerow(['User', user.get_full_name() or user.username])
    writer.writerow(['Week', f"{summary_data['week_start_date']} to {summary_data['week_end_date']}"])
    writer.writerow(['Generated', datetime.now().isoformat()])
    writer.writerow([])
    
    # Task Metrics
    writer.writerow(['Task Metrics', ''])
    writer.writerow(['Tasks Created', summary_data.get('tasks_created', 0)])
    writer.writerow(['Tasks Assigned', summary_data.get('tasks_assigned', 0)])
    writer.writerow(['Tasks Completed', summary_data.get('tasks_completed', 0)])
    writer.writerow(['Completion Rate (%)', summary_data.get('completion_rate_percent', 0)])
    writer.writerow(['On-Time Completion Rate (%)', summary_data.get('on_time_completion_rate_percent', 0)])
    writer.writerow([])
    
    # High Priority
    writer.writerow(['High Priority Tasks', ''])
    writer.writerow(['Total High Priority', summary_data.get('high_priority_tasks', 0)])
    writer.writerow(['High Priority Completed', summary_data.get('high_priority_completed', 0)])
    writer.writerow([])
    
    # Engagement
    writer.writerow(['Engagement Metrics', ''])
    writer.writerow(['Comments Added', summary_data.get('comments_added', 0)])
    writer.writerow(['Files Attached', summary_data.get('files_attached', 0)])
    writer.writerow(['Recurring Schedules Created', summary_data.get('recurring_schedules_created', 0)])
    writer.writerow(['Active Recurring Schedules', summary_data.get('active_recurring_schedules', 0)])
    writer.writerow([])
    
    # Priority Distribution
    priority_dist = summary_data.get('priority_distribution', {})
    if priority_dist:
        writer.writerow(['Priority Distribution', ''])
        for priority, count in priority_dist.items():
            writer.writerow([priority.capitalize(), count])
        writer.writerow([])
    
    # Status Distribution
    status_dist = summary_data.get('status_distribution', {})
    if status_dist:
        writer.writerow(['Status Distribution', ''])
        for status, count in status_dist.items():
            writer.writerow([status.replace('_', ' ').title(), count])
    
    return output


def generate_summary_pdf(summary_data: dict, user: User, comparison_data: dict | None = None) -> bytes:
    """
    Generate PDF export of a summary using reportlab
    
    Note: Requires reportlab to be installed: pip install reportlab
    """
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib import colors
    except ImportError:
        raise ImportError("reportlab is required for PDF export. Install with: pip install reportlab")
    
    # Create PDF in memory
    pdf_buffer = io.BytesIO()
    doc = SimpleDocTemplate(pdf_buffer, pagesize=letter)
    story = []
    styles = getSampleStyleSheet()
    
    # Title
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1e40af'),
        spaceAfter=30,
        alignment=1  # Center
    )
    story.append(Paragraph('Weekly Summary Report', title_style))
    story.append(Spacer(1, 0.2 * inch))
    
    # Header info
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
    
    # Task Metrics
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
    
    # Week-over-week comparison if available
    if comparison_data:
        story.append(Paragraph('Week-over-Week Comparison', styles['Heading2']))
        comparison_table_data = [
            ['Metric', 'Change', 'Trend'],
            ['Completion Rate', f"{comparison_data.get('delta_completion_rate', 0):+.1f}%", 
             comparison_data.get('trend', 'flat')],
            ['Tasks Completed', f"{comparison_data.get('delta_tasks_completed', 0):+d}",
             comparison_data.get('trend', 'flat')],
            ['On-Time Rate', f"{comparison_data.get('delta_on_time_completion_rate', 0):+.1f}%",
             comparison_data.get('trend', 'flat')],
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
    
    # Engagement Metrics
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
    
    # Build PDF
    doc.build(story)
    return pdf_buffer.getvalue()


def save_export_to_s3(file_bytes: bytes, filename: str, content_type: str) -> str:
    """
    Save export file to S3 and return URL
    
    Note: Requires boto3 and S3 configuration in settings
    """
    try:
        import boto3
        from django.conf import settings
    except ImportError:
        # Fallback: save locally for development
        import os
        export_dir = os.path.join(os.path.dirname(__file__), '../../exports')
        os.makedirs(export_dir, exist_ok=True)
        filepath = os.path.join(export_dir, filename)
        with open(filepath, 'wb') as f:
            f.write(file_bytes)
        return f'/exports/{filename}'
    
    # S3 upload
    s3_client = boto3.client('s3')
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    key = f'summaries/{filename}'
    
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=file_bytes,
        ContentType=content_type,
    )
    
    # Generate URL
    url = s3_client.generate_presigned_url(
        'get_object',
        Params={'Bucket': bucket, 'Key': key},
        ExpiresIn=604800  # 7 days
    )
    return url
