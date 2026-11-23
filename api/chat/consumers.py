"""The chat WebSocket. It only delivers events; every change (sending,
editing, reading) goes through the REST API, which applies the usual
authentication, validation, throttling and audit rules.

Connect with a one-time ticket from POST /api/v1/chat/ws-ticket:

    wss://<realtime host>/ws/chat/?ticket=...

Client -> server:  {"type": "ping"}  every 25 s (keeps presence and the
                   connection alive through Cloudflare's 100 s idle limit)
                   {"type": "typing", "conversation_id": "..."}
Server -> client:  {"event": "...", "data": {...}}  (see docs/CHAT_SPEC.md)
"""

from __future__ import annotations

import asyncio
import time
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone

from chat import realtime

User = get_user_model()

RECHECK_SECONDS = 300
# How often an open socket refreshes last_seen_at, so "last seen" stays
# accurate even when a socket dies without a clean disconnect.
LAST_SEEN_INTERVAL = 60.0
TYPING_INTERVAL = 3.0

CLOSE_UNAUTHORISED = 4001
CLOSE_FORBIDDEN_ORIGIN = 4003


def _allowed_origins() -> set[str]:
    origins = set(getattr(settings, 'CORS_ALLOWED_ORIGINS', []) or [])
    if settings.DEBUG:
        origins |= {'http://localhost:3000', 'http://127.0.0.1:3000'}
    return {o.rstrip('/') for o in origins}


def origin_allowed(scope) -> bool:
    headers = dict(scope.get('headers') or [])
    origin = headers.get(b'origin', b'').decode('latin-1').rstrip('/')
    return bool(origin) and origin in _allowed_origins()


@database_sync_to_async
def _active_user(user_id):
    return User.objects.filter(pk=user_id, is_active=True).first()


@database_sync_to_async
def _conversation_ids(user_id) -> set[str]:
    from chat.models import Participant

    return {
        str(cid)
        for cid in Participant.objects.filter(user_id=user_id, left_at__isnull=True).values_list(
            'conversation_id', flat=True
        )
    }


@database_sync_to_async
def _other_members(conversation_id, user_id) -> list[int]:
    from chat.models import Participant

    return list(
        Participant.objects.filter(conversation_id=conversation_id, left_at__isnull=True)
        .exclude(user_id=user_id)
        .values_list('user_id', flat=True)
    )


@database_sync_to_async
def _record_last_seen(user_id):
    from chat.models import ChatAccount

    ChatAccount.objects.filter(user_id=user_id).update(last_seen_at=timezone.now())


@database_sync_to_async
def _announce_presence(user_id, online: bool):
    """Tell everyone who shares a conversation with the user."""
    from chat.models import ChatAccount, Participant

    mine = Participant.objects.filter(user_id=user_id, left_at__isnull=True).values('conversation_id')
    others = set(
        Participant.objects.filter(conversation_id__in=mine, left_at__isnull=True)
        .exclude(user_id=user_id)
        .values_list('user_id', flat=True)
    )
    last_seen = ChatAccount.objects.filter(user_id=user_id).values_list('last_seen_at', flat=True).first()
    realtime.broadcast(others, 'presence', {'user_id': user_id, 'online': online, 'last_seen_at': last_seen})


class ChatConsumer(AsyncJsonWebsocketConsumer):
    user_id = None
    conversations: set[str]
    _last_typing: dict[str, float]
    _recheck_task = None
    _last_seen_written = 0.0

    async def connect(self):
        if not origin_allowed(self.scope):
            await self.close(code=CLOSE_FORBIDDEN_ORIGIN)
            return

        query = parse_qs((self.scope.get('query_string') or b'').decode())
        ticket = (query.get('ticket') or [''])[0]
        user_id = await database_sync_to_async(realtime.redeem_ticket)(ticket)
        user = await _active_user(user_id) if user_id is not None else None
        if user is None:
            await self.close(code=CLOSE_UNAUTHORISED)
            return

        self.user_id = user.pk
        self.conversations = await _conversation_ids(user.pk)
        self._last_typing = {}
        await self.channel_layer.group_add(realtime.user_group(user.pk), self.channel_name)
        await self.accept()
        came_online = await database_sync_to_async(realtime.socket_opened)(user.pk)
        await self._touch_last_seen(force=True)
        if came_online:
            await _announce_presence(user.pk, True)
        self._recheck_task = asyncio.ensure_future(self._recheck_loop())

    async def disconnect(self, code):
        if self._recheck_task is not None:
            self._recheck_task.cancel()
        if self.user_id is not None:
            await self.channel_layer.group_discard(realtime.user_group(self.user_id), self.channel_name)
            await _record_last_seen(self.user_id)
            if await database_sync_to_async(realtime.socket_closed)(self.user_id):
                await _announce_presence(self.user_id, False)

    async def _touch_last_seen(self, force=False):
        now = time.monotonic()
        if force or now - self._last_seen_written >= LAST_SEEN_INTERVAL:
            self._last_seen_written = now
            await _record_last_seen(self.user_id)

    async def _recheck_loop(self):
        """A deactivated user's open socket is closed within five minutes."""
        try:
            while True:
                await asyncio.sleep(RECHECK_SECONDS)
                if await _active_user(self.user_id) is None:
                    await self.close(code=CLOSE_UNAUTHORISED)
                    return
        except asyncio.CancelledError:
            pass

    async def receive_json(self, content, **kwargs):
        if not isinstance(content, dict):
            return
        kind = content.get('type')
        if kind == 'ping':
            await database_sync_to_async(realtime.mark_online)(self.user_id)
            await self._touch_last_seen()
            await self.send_json({'event': 'pong', 'data': {}})
        elif kind == 'typing':
            await self._typing(str(content.get('conversation_id') or ''))

    async def _typing(self, conversation_id):
        if conversation_id not in self.conversations:
            return
        now = time.monotonic()
        if now - self._last_typing.get(conversation_id, 0) < TYPING_INTERVAL:
            return
        self._last_typing[conversation_id] = now
        for other in await _other_members(conversation_id, self.user_id):
            await self.channel_layer.group_send(
                realtime.user_group(other),
                {
                    'type': 'chat.event',
                    'event': 'typing',
                    'data': {'conversation_id': conversation_id, 'user_id': self.user_id},
                },
            )

    async def chat_event(self, message):
        event = message.get('event')
        data = message.get('data') or {}
        if event == 'conversation.new':
            self.conversations.add(str(data.get('conversation_id')))
        elif event == 'conversation.removed':
            # Removed from a group, or left it: no more typing to or from it.
            self.conversations.discard(str(data.get('conversation_id')))
        await self.send_json({'event': event, 'data': data})
