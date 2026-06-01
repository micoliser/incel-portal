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
    doc = SimpleDocTemplate(
        pdf_buffer,
        pagesize=letter,
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.65 * inch,
    )
    story = []
    styles = getSampleStyleSheet()

    palette = {
        'navy': colors.HexColor('#1e3a8a'),
        'blue': colors.HexColor('#2563eb'),
        'blue_light': colors.HexColor('#dbeafe'),
        'teal': colors.HexColor('#0f766e'),
        'teal_light': colors.HexColor('#ccfbf1'),
        'amber': colors.HexColor('#b45309'),
        'amber_light': colors.HexColor('#fef3c7'),
        'slate': colors.HexColor('#475569'),
        'slate_light': colors.HexColor('#f8fafc'),
        'border': colors.HexColor('#cbd5e1'),
        'muted': colors.HexColor('#64748b'),
        'success': colors.HexColor('#059669'),
        'success_light': colors.HexColor('#d1fae5'),
        'warning': colors.HexColor('#d97706'),
    }

    def to_int(value, default=0):
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return default

    def to_float(value, default=0.0):
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return default

    def get_daily_reports():
        daily_reports = summary_data.get('daily_reports') or []
        if daily_reports:
            return daily_reports

        try:
            from datetime import datetime
            from .services import calculate_user_weekly_summary

            week_start = datetime.strptime(summary_data['week_start_date'], '%Y-%m-%d').date()
            week_end = datetime.strptime(summary_data['week_end_date'], '%Y-%m-%d').date()
            computed = calculate_user_weekly_summary(user, week_start, week_end)
            return computed.get('daily_reports') or []
        except Exception:
            return []

    def pct_text(value):
        return f"{to_float(value):.1f}%"

    def metric_card(title, value, accent, note=None):
        title_style = ParagraphStyle(
            f'CardTitle{title.replace(" ", "")}',
            parent=styles['BodyText'],
            fontName='Helvetica-Bold',
            fontSize=10,
            leading=12,
            textColor=accent,
            alignment=0,
            spaceAfter=4,
        )
        value_style = ParagraphStyle(
            f'CardValue{title.replace(" ", "")}',
            parent=styles['BodyText'],
            fontName='Helvetica-Bold',
            fontSize=18,
            leading=20,
            textColor=palette['navy'],
            alignment=0,
        )
        note_style = ParagraphStyle(
            f'CardNote{title.replace(" ", "")}',
            parent=styles['BodyText'],
            fontSize=8,
            leading=10,
            textColor=palette['muted'],
            alignment=0,
        )
        parts = [Paragraph(title, title_style), Paragraph(value, value_style)]
        if note:
            parts.append(Paragraph(note, note_style))
        return parts

    def section_style(text, color=palette['navy']):
        return ParagraphStyle(
            f'Section{text.replace(" ", "")}',
            parent=styles['Heading2'],
            fontName='Helvetica-Bold',
            fontSize=12,
            leading=14,
            textColor=color,
            spaceBefore=2,
            spaceAfter=8,
        )

    def build_metric_table(rows):
        table = Table(rows, colWidths=[2.65 * inch, 3.55 * inch], hAlign='LEFT')
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), palette['slate_light']),
            ('BACKGROUND', (1, 0), (1, -1), colors.white),
            ('TEXTCOLOR', (0, 0), (-1, -1), palette['slate']),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 9.5),
            ('LEADING', (0, 0), (-1, -1), 11),
            ('TOPPADDING', (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('GRID', (0, 0), (-1, -1), 0.6, palette['border']),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        return table

    def build_distribution_table(title, values, order):
        if not values:
            return None

        rows = [[title, 'Count']]
        for key in order:
            rows.append([key.replace('_', ' ').title(), str(to_int(values.get(key)))])

        table = Table(rows, colWidths=[3.7 * inch, 2.5 * inch], hAlign='LEFT')
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), palette['blue']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('ALIGN', (1, 1), (1, -1), 'LEFT'),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, palette['slate_light']]),
            ('GRID', (0, 0), (-1, -1), 0.6, palette['border']),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        return table

    def add_page_number(canvas, doc_obj):
        canvas.saveState()
        canvas.setStrokeColor(palette['border'])
        canvas.setLineWidth(0.6)
        canvas.line(doc_obj.leftMargin, doc_obj.bottomMargin - 10, doc_obj.pagesize[0] - doc_obj.rightMargin, doc_obj.bottomMargin - 10)
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(palette['muted'])
        canvas.drawString(doc_obj.leftMargin, doc_obj.bottomMargin - 24, f'Exported for {user.get_full_name() or user.username}')
        canvas.drawRightString(doc_obj.pagesize[0] - doc_obj.rightMargin, doc_obj.bottomMargin - 24, f'Page {doc_obj.page}')
        canvas.restoreState()

    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=22,
        leading=26,
        textColor=palette['navy'],
        spaceAfter=8,
        alignment=0,
    )
    subtitle_style = ParagraphStyle(
        'Subtitle',
        parent=styles['BodyText'],
        fontSize=9,
        leading=11,
        textColor=palette['muted'],
        spaceAfter=0,
    )
    letterhead_style = ParagraphStyle(
        'Letterhead',
        parent=styles['BodyText'],
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=12,
        textColor=palette['blue'],
        alignment=0,
        spaceAfter=2,
    )
    letterhead_tag_style = ParagraphStyle(
        'LetterheadTag',
        parent=styles['BodyText'],
        fontSize=8,
        leading=10,
        textColor=palette['muted'],
        alignment=0,
        spaceAfter=0,
    )
    letterhead_rule = Table([['', '']], colWidths=[6.0 * inch], hAlign='LEFT')
    letterhead_rule.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, -1), 1.0, palette['border']),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    story.append(Paragraph('INCEL WORKSPACE', letterhead_style))
    story.append(Paragraph('Weekly summary export', letterhead_tag_style))
    story.append(letterhead_rule)
    story.append(Spacer(1, 0.08 * inch))
    story.append(Paragraph('Weekly Summary Report', title_style))
    story.append(Paragraph('A compact export of the most important weekly signals, trends, and activity.', subtitle_style))
    story.append(Spacer(1, 0.16 * inch))

    header_data = [
        ['User', user.get_full_name() or user.username],
        ['Week', f"{summary_data['week_start_date']} to {summary_data['week_end_date']}"],
        ['Generated', timezone.now().strftime('%Y-%m-%d %H:%M:%S')],
        ['Comparison', 'Included' if comparison_data else 'Not available'],
    ]
    header_table = Table(header_data, colWidths=[1.45 * inch, 4.95 * inch], hAlign='LEFT')
    header_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), palette['slate_light']),
        ('BACKGROUND', (1, 0), (1, -1), colors.white),
        ('TEXTCOLOR', (0, 0), (-1, -1), palette['slate']),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.6, palette['border']),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 0.22 * inch))

    story.append(Paragraph('Weekly Snapshot', section_style('Weekly Snapshot', palette['blue'])))
    snapshot_cards = [
        metric_card('Tasks Completed', str(to_int(summary_data.get('tasks_completed'))), palette['success'], 'Finished this week'),
        metric_card('Completion Rate', pct_text(summary_data.get('completion_rate_percent')), palette['blue'], 'Across all tasks'),
        metric_card('On-Time Rate', pct_text(summary_data.get('on_time_completion_rate_percent')), palette['teal'], 'Deadline performance'),
        metric_card('Daily Reports', str(to_int(summary_data.get('daily_reports_created'))), palette['teal'], 'Daily report entries'),
        metric_card('Files Received', str(to_int(summary_data.get('files_received', summary_data.get('files_attached')))), palette['amber'], 'Attachments seen'),
        metric_card('Comments Added', str(to_int(summary_data.get('comments_added'))), palette['navy'], 'Activity and collaboration'),
        metric_card('High Priority Done', str(to_int(summary_data.get('high_priority_completed'))), palette['warning'], 'Urgent work completed'),
    ]
    snapshot_rows = [snapshot_cards[i:i + 3] for i in range(0, len(snapshot_cards), 3)]
    snapshot_table = Table(snapshot_rows, colWidths=[2.0 * inch, 2.0 * inch, 2.0 * inch], hAlign='LEFT')
    snapshot_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('BACKGROUND', (0, 0), (-1, -1), palette['slate_light']),
        ('BOX', (0, 0), (-1, -1), 0.6, palette['border']),
        ('INNERGRID', (0, 0), (-1, -1), 0.6, palette['border']),
    ]))
    story.append(snapshot_table)
    story.append(Spacer(1, 0.18 * inch))

    overview_text = summary_data.get('summary_message')
    overview_body = overview_text or 'No summary message was stored for this week, so this export focuses on the core metrics and distribution breakdowns.'

    story.append(Paragraph('Summary Insight', section_style('Summary Insight', palette['teal'])))
    insight_table = Table([
        [Paragraph(overview_body, ParagraphStyle(
            'InsightBody',
            parent=styles['BodyText'],
            fontSize=9.5,
            leading=12,
            textColor=palette['slate'],
        ))]
    ], colWidths=[6.0 * inch], hAlign='LEFT')
    insight_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), palette['teal_light'] if overview_text else palette['slate_light']),
        ('BOX', (0, 0), (-1, -1), 0.6, palette['border']),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(insight_table)
    story.append(Spacer(1, 0.18 * inch))

    story.append(Paragraph('Task Metrics', section_style('Task Metrics', palette['blue'])))
    metrics_table = build_metric_table([
        ['Tasks Created', str(to_int(summary_data.get('tasks_created')))],
        ['Tasks Assigned', str(to_int(summary_data.get('tasks_assigned')))],
        ['Tasks Completed', str(to_int(summary_data.get('tasks_completed')))],
        ['Completion Rate', pct_text(summary_data.get('completion_rate_percent'))],
        ['On-Time Completion Rate', pct_text(summary_data.get('on_time_completion_rate_percent'))],
        ['High Priority Tasks', str(to_int(summary_data.get('high_priority_tasks')))],
        ['High Priority Completed', str(to_int(summary_data.get('high_priority_completed')))],
        ['Active Recurring Schedules', str(to_int(summary_data.get('active_recurring_schedules')))],
    ])
    story.append(metrics_table)
    story.append(Spacer(1, 0.18 * inch))

    story.append(Paragraph('Engagement Metrics', section_style('Engagement Metrics', palette['amber'])))
    engagement_table = build_metric_table([
        ['Comments Added', str(to_int(summary_data.get('comments_added')))],
        ['Files Attached', str(to_int(summary_data.get('files_attached')))],
        ['Files Received', str(to_int(summary_data.get('files_received', summary_data.get('files_attached'))))],
        ['Daily Reports Created', str(to_int(summary_data.get('daily_reports_created')))],
        ['Daily Report Subreports', str(to_int(summary_data.get('daily_reports_subreports_created')))],
        ['Recurring Schedules Created', str(to_int(summary_data.get('recurring_schedules_created')))],
        ['Priority Spread', ', '.join(f"{key}: {to_int(value)}" for key, value in (summary_data.get('priority_distribution') or {}).items()) or 'Not available'],
        ['Status Spread', ', '.join(f"{key}: {to_int(value)}" for key, value in (summary_data.get('status_distribution') or {}).items()) or 'Not available'],
    ])
    story.append(engagement_table)
    story.append(Spacer(1, 0.18 * inch))

    daily_reports = get_daily_reports()
    if daily_reports:
        story.append(Paragraph('Daily Reports', section_style('Daily Reports', palette['teal'])))
        daily_reports_rows = [['Date', 'Title', 'Subreports']]
        for report in daily_reports:
            daily_reports_rows.append([
                str(report.get('report_date', '')),
                str(report.get('title', 'Untitled')),
                str(to_int(report.get('subreport_count'))),
            ])

        daily_reports_table = Table(daily_reports_rows, colWidths=[1.45 * inch, 3.65 * inch, 1.1 * inch], hAlign='LEFT')
        daily_reports_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), palette['teal']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, palette['slate_light']]),
            ('GRID', (0, 0), (-1, -1), 0.6, palette['border']),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(daily_reports_table)
        story.append(Spacer(1, 0.18 * inch))

    priority_table = build_distribution_table(
        'Priority',
        summary_data.get('priority_distribution') or {},
        ['low', 'medium', 'high'],
    )
    if priority_table:
        story.append(Paragraph('Priority Distribution', section_style('Priority Distribution', palette['navy'])))
        story.append(priority_table)
        story.append(Spacer(1, 0.14 * inch))

    status_table = build_distribution_table(
        'Status',
        summary_data.get('status_distribution') or {},
        ['pending', 'in_progress', 'completed'],
    )
    if status_table:
        story.append(Paragraph('Status Distribution', section_style('Status Distribution', palette['navy'])))
        story.append(status_table)
        story.append(Spacer(1, 0.14 * inch))

    if comparison_data:
        story.append(Paragraph('Week-over-Week Comparison', section_style('Week-over-Week Comparison', palette['success'])))
        trend = comparison_data.get('trend', 'flat')
        trend_labels = {
            'up': 'Improving compared with last week',
            'down': 'Slower than last week',
            'flat': 'Broadly unchanged from last week',
        }
        comparison_intro = f"Trend: {str(trend).title()}. {trend_labels.get(trend, trend_labels['flat'])}"
        if comparison_data.get('velocity_change_percent') is not None:
            comparison_intro += f" Velocity change: {to_float(comparison_data.get('velocity_change_percent')):+.1f}%."

        comparison_table_data = [
            ['Metric', 'Change'],
            ['Tasks Completed', f"{to_int(comparison_data.get('delta_tasks_completed')):+d}"],
            ['Completion Rate', f"{to_float(comparison_data.get('delta_completion_rate')):+.1f}%"],
            ['On-Time Rate', f"{to_float(comparison_data.get('delta_on_time_completion_rate')):+.1f}%"],
            ['High Priority Completed', f"{to_int(comparison_data.get('delta_high_priority_completed')):+d}"],
            ['Comments', f"{to_int(comparison_data.get('delta_comments')):+d}"],
            ['Files', f"{to_int(comparison_data.get('delta_files')):+d}"],
        ]
        comparison_table = Table(comparison_table_data, colWidths=[3.8 * inch, 2.2 * inch], hAlign='LEFT')
        comparison_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), palette['success']),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (1, 1), (1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, palette['slate_light']]),
            ('GRID', (0, 0), (-1, -1), 0.6, palette['border']),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(Paragraph(comparison_intro, ParagraphStyle(
            'ComparisonIntro',
            parent=styles['BodyText'],
            fontSize=9.5,
            leading=12,
            textColor=palette['slate'],
            spaceAfter=6,
        )))
        story.append(comparison_table)

    def add_page_number(canvas, doc_obj):
        canvas.saveState()
        canvas.setStrokeColor(palette['border'])
        canvas.setLineWidth(0.6)
        canvas.line(doc_obj.leftMargin, doc_obj.bottomMargin - 10, doc_obj.pagesize[0] - doc_obj.rightMargin, doc_obj.bottomMargin - 10)
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(palette['muted'])
        canvas.drawString(doc_obj.leftMargin, doc_obj.bottomMargin - 24, f'Exported for {user.get_full_name() or user.username}')
        canvas.drawRightString(doc_obj.pagesize[0] - doc_obj.rightMargin, doc_obj.bottomMargin - 24, f'Page {doc_obj.page}')
        canvas.restoreState()

    doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
    return pdf_buffer.getvalue()


def save_export_to_s3(file_bytes: bytes, filename: str, content_type: str) -> str:
    """Save export file to S3 and return a presigned URL."""
    bucket = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
    if not bucket:
        raise RuntimeError('AWS_S3_BUCKET_NAME is not configured.')

    prefix = getattr(settings, 'SUMMARY_PDF_EXPORT_S3_PREFIX', 'pdf-exports').strip() or 'pdf-exports'
    key = f'{prefix}/summaries/{filename}'
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