from typing import Any, Dict

from emails.config import EmailType
from emails.services.base_email_service import BaseEmailService


class ChatInvitationEmailService(BaseEmailService):
    """Sent when someone invites a colleague who has not set up chat.
    Carries no message content (there is none yet, and chat is encrypted)."""

    email_type = EmailType.CHAT_INVITATION
    template_name = "emails/chat/chat_invitation.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        return f"{context['inviter_name']} wants to chat with you on Incel Portal"


def send_chat_invitation_email(invitee: Any, inviter_name: str) -> None:
    ChatInvitationEmailService().send(
        [invitee.email],
        {'first_name': invitee.first_name or invitee.username, 'inviter_name': inviter_name},
    )


class ChatResetCodeEmailService(BaseEmailService):
    """The code that confirms a chat reset (start over with a new key),
    with a warning of what resetting means."""

    email_type = EmailType.CHAT_RESET_CODE
    template_name = "emails/chat/chat_reset_code.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        return f"Your chat reset code: {context['code']}"


def send_chat_reset_code_email(user: Any, code: str, expiry_minutes: int) -> None:
    ChatResetCodeEmailService().send(
        [user.email],
        {'first_name': user.first_name or user.username, 'code': code, 'expiry_minutes': expiry_minutes},
    )
