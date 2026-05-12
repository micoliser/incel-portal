from django.shortcuts import render
from django.contrib.admin.views.decorators import staff_member_required


@staff_member_required
def email_log_view(request):
    """
    View to display email logs (for admin/debugging).
    Can be extended to show email previews.
    """
    from emails.models import EmailLog
    
    logs = EmailLog.objects.all()[:100]
    return render(request, 'emails/admin/email_logs.html', {'logs': logs})
