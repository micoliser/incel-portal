from django.urls import path

from . import views_api as views

urlpatterns = [
    path('chat/account', views.AccountView.as_view(), name='chat-account'),
    path('chat/account/reset', views.AccountResetView.as_view(), name='chat-account-reset'),
    path('chat/account/reset/code', views.AccountResetCodeView.as_view(), name='chat-account-reset-code'),
    path('chat/account/reset/code/check', views.AccountResetCodeCheckView.as_view(), name='chat-account-reset-code-check'),
    path('chat/account/check-password', views.PasswordCheckView.as_view(), name='chat-account-check-password'),
    path('chat/session-secrets', views.SessionSecretsView.as_view(), name='chat-session-secrets'),
    path('chat/session-secrets/<str:secret_id>', views.SessionSecretView.as_view(), name='chat-session-secret'),
    path('chat/ws-ticket', views.TicketView.as_view(), name='chat-ws-ticket'),
    path('chat/people', views.PeopleView.as_view(), name='chat-people'),
    path('chat/people/<int:user_id>/invite', views.InviteView.as_view(), name='chat-people-invite'),
    path('chat/unread-count', views.UnreadCountView.as_view(), name='chat-unread-count'),
    path('chat/conversations', views.ConversationsView.as_view(), name='chat-conversations'),
    path('chat/conversations/<uuid:conversation_id>', views.ConversationView.as_view(), name='chat-conversation'),
    path(
        'chat/conversations/<uuid:conversation_id>/keys',
        views.ConversationKeysView.as_view(),
        name='chat-conversation-keys',
    ),
    path(
        'chat/conversations/<uuid:conversation_id>/messages',
        views.MessagesView.as_view(),
        name='chat-conversation-messages',
    ),
    path('chat/conversations/<uuid:conversation_id>/read', views.ReadView.as_view(), name='chat-conversation-read'),
    path(
        'chat/conversations/<uuid:conversation_id>/attachments',
        views.AttachmentsView.as_view(),
        name='chat-conversation-attachments',
    ),
    path(
        'chat/conversations/<uuid:conversation_id>/attachments/forward',
        views.ForwardAttachmentView.as_view(),
        name='chat-conversation-attachments-forward',
    ),
    path('chat/messages/<uuid:message_id>', views.MessageView.as_view(), name='chat-message'),
    path(
        'chat/messages/<uuid:message_id>/reaction',
        views.MessageReactionView.as_view(),
        name='chat-message-reaction',
    ),
    path(
        'chat/attachments/<uuid:attachment_id>/download',
        views.AttachmentDownloadView.as_view(),
        name='chat-attachment-download',
    ),
]
