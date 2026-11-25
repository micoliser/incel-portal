"""Short-lived chat state kept in the cache (Redis in production), and
delivery of events to open WebSockets through the channel layer.

Nothing here is a source of truth: losing it means people look offline,
reconnect, or enter their chat PIN again.
"""

from __future__ import annotations

import json
import logging
import secrets
from typing import Iterable

from asgiref.sync import async_to_sync
from django.core.cache import cache
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction

logger = logging.getLogger(__name__)

PRESENCE_TTL = 60
TICKET_TTL = 30
# Matches the refresh token lifetime: a browser's sealed chat key is useless
# once the sign-in it was unlocked under has ended.
SESSION_SECRET_TTL = 12 * 60 * 60


def user_group(user_id) -> str:
    return f'chat_user_{user_id}'


# --- Presence --------------------------------------------------------------

def _presence_key(user_id) -> str:
    return f'chat:presence:{user_id}'


def mark_online(user_id) -> None:
    cache.set(_presence_key(user_id), 1, PRESENCE_TTL)


def is_online(user_id) -> bool:
    return bool(cache.get(_presence_key(user_id)))


def _connections_key(user_id) -> str:
    return f'chat:connections:{user_id}'


def socket_opened(user_id) -> bool:
    """Count an open socket (one per tab). True if the user was offline."""
    was_online = is_online(user_id)
    key = _connections_key(user_id)
    cache.add(key, 0, SESSION_SECRET_TTL)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, SESSION_SECRET_TTL)
    mark_online(user_id)
    return not was_online


def socket_closed(user_id) -> bool:
    """Forget an open socket. True if it was the user's last one, in which
    case they are shown offline straight away rather than after the TTL."""
    key = _connections_key(user_id)
    try:
        left = cache.decr(key)
    except ValueError:
        left = 0
    if left > 0:
        return False
    cache.delete_many([key, _presence_key(user_id)])
    return True


def online_user_ids(user_ids: Iterable[int]) -> set[int]:
    ids = list(user_ids)
    if not ids:
        return set()
    found = cache.get_many([_presence_key(uid) for uid in ids])
    return {uid for uid in ids if found.get(_presence_key(uid))}


# --- WebSocket tickets -----------------------------------------------------

def _ticket_key(ticket: str) -> str:
    return f'chat:ticket:{ticket}'


def issue_ticket(user_id) -> str:
    ticket = secrets.token_urlsafe(32)
    cache.set(_ticket_key(ticket), user_id, TICKET_TTL)
    return ticket


def redeem_ticket(ticket: str):
    """The user id a ticket was issued to, once; None if unknown or used."""
    if not ticket or len(ticket) > 100:
        return None
    key = _ticket_key(ticket)
    user_id = cache.get(key)
    if user_id is None:
        return None
    cache.delete(key)
    return user_id


# --- Session secrets (seal the browser's copy of the chat key) ------------

def _secret_key(user_id, secret_id: str) -> str:
    return f'chat:secret:{user_id}:{secret_id}'


def create_session_secret(user_id) -> tuple[str, str]:
    secret_id = secrets.token_urlsafe(16)
    secret = secrets.token_bytes(32).hex()
    cache.set(_secret_key(user_id, secret_id), secret, SESSION_SECRET_TTL)
    return secret_id, secret


def get_session_secret(user_id, secret_id: str):
    if not secret_id or len(secret_id) > 64:
        return None
    return cache.get(_secret_key(user_id, secret_id))


def delete_session_secret(user_id, secret_id: str) -> None:
    if secret_id and len(secret_id) <= 64:
        cache.delete(_secret_key(user_id, secret_id))


# --- Broadcasting ----------------------------------------------------------

def _send_now(user_ids, event: str, data: dict) -> None:
    from channels.layers import get_channel_layer

    layer = get_channel_layer()
    if layer is None:
        return
    message = {'type': 'chat.event', 'event': event, 'data': data}
    for user_id in set(user_ids):
        try:
            async_to_sync(layer.group_send)(user_group(user_id), message)
        except Exception:
            # Delivery is best effort: clients catch up from the API when
            # they reconnect, so a Redis problem must not fail the request.
            logger.warning('Could not deliver chat event %s to user %s', event, user_id, exc_info=True)


def broadcast(user_ids: Iterable[int], event: str, data: dict) -> None:
    """Send an event to every open socket of the given users, after the
    current transaction commits (so nobody hears about a rolled-back change)."""
    ids = list(user_ids)
    if ids:
        # Plain JSON types only: the channel layer and the socket both serialise.
        plain = json.loads(json.dumps(data, cls=DjangoJSONEncoder))
        transaction.on_commit(lambda: _send_now(ids, event, plain))
