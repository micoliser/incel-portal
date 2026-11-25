import json

from asgiref.testing import ApplicationCommunicator
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase, override_settings

from chat import realtime
from portalapi.asgi import application

User = get_user_model()


class WebsocketCommunicator(ApplicationCommunicator):
    """Minimal WebSocket test client (channels.testing needs daphne installed)."""

    def __init__(self, app, path, headers):
        path, _, query = path.partition('?')
        super().__init__(
            app,
            {'type': 'websocket', 'path': path, 'query_string': query.encode(), 'headers': headers, 'subprotocols': []},
        )

    async def connect(self):
        await self.send_input({'type': 'websocket.connect'})
        response = await self.receive_output(5)
        if response['type'] == 'websocket.close':
            return False, response.get('code', 1000)
        return True, None

    async def send_json_to(self, data):
        await self.send_input({'type': 'websocket.receive', 'text': json.dumps(data)})

    async def receive_json_from(self):
        response = await self.receive_output(5)
        return json.loads(response['text'])

    async def receive_nothing(self, timeout=0.3):
        return await super().receive_nothing(timeout)

    async def disconnect(self):
        await self.send_input({'type': 'websocket.disconnect', 'code': 1000})
        await self.wait(5)

ORIGIN = 'http://portal.example'


@override_settings(CORS_ALLOWED_ORIGINS=[ORIGIN])
class ConsumerTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='u@example.com', email='u@example.com', password='x')

    def communicator(self, ticket, origin=ORIGIN):
        return WebsocketCommunicator(
            application, f'/ws/chat/?ticket={ticket}', headers=[(b'origin', origin.encode())]
        )

    async def test_ticket_is_single_use_and_events_arrive(self):
        from asgiref.sync import sync_to_async

        ticket = await sync_to_async(realtime.issue_ticket)(self.user.pk)
        socket = self.communicator(ticket)
        connected, _ = await socket.connect()
        self.assertTrue(connected)

        await sync_to_async(realtime._send_now)([self.user.pk], 'message.new', {'conversation_id': 'c'})
        self.assertEqual(await socket.receive_json_from(), {'event': 'message.new', 'data': {'conversation_id': 'c'}})

        # Payloads with dates (every message has them) are delivered too.
        from django.db import transaction
        from django.utils import timezone

        def broadcast_with_date():
            with transaction.atomic():
                realtime.broadcast([self.user.pk], 'message.new', {'created_at': timezone.now()})

        await sync_to_async(broadcast_with_date)()
        self.assertIn('created_at', (await socket.receive_json_from())['data'])

        await socket.send_json_to({'type': 'ping'})
        self.assertEqual((await socket.receive_json_from())['event'], 'pong')
        self.assertTrue(await sync_to_async(realtime.is_online)(self.user.pk))
        await socket.disconnect()

        again = self.communicator(ticket)
        connected, code = await again.connect()
        self.assertFalse(connected)
        self.assertEqual(code, 4001)

    async def test_foreign_origin_is_refused(self):
        from asgiref.sync import sync_to_async

        ticket = await sync_to_async(realtime.issue_ticket)(self.user.pk)
        socket = self.communicator(ticket, origin='https://evil.example')
        connected, code = await socket.connect()
        self.assertFalse(connected)
        self.assertEqual(code, 4003)

    async def test_unknown_ticket_is_refused(self):
        socket = self.communicator('nope')
        connected, code = await socket.connect()
        self.assertFalse(connected)
        self.assertEqual(code, 4001)

    async def test_presence_is_announced_to_conversation_members(self):
        from asgiref.sync import sync_to_async

        from chat.models import Conversation, Participant

        def make_pair():
            other = User.objects.create_user(username='o@example.com', email='o@example.com', password='x')
            conversation = Conversation.objects.create(direct_key='pair')
            Participant.objects.create(conversation=conversation, user=self.user)
            Participant.objects.create(conversation=conversation, user=other)
            return other

        other = await sync_to_async(make_pair)()
        watcher = self.communicator(await sync_to_async(realtime.issue_ticket)(other.pk))
        self.assertTrue((await watcher.connect())[0])

        first_tab = self.communicator(await sync_to_async(realtime.issue_ticket)(self.user.pk))
        self.assertTrue((await first_tab.connect())[0])
        event = await watcher.receive_json_from()
        self.assertEqual(event['event'], 'presence')
        self.assertEqual(event['data']['user_id'], self.user.pk)
        self.assertTrue(event['data']['online'])

        # A second tab does not announce again, and closing one tab of two
        # keeps the user online.
        second_tab = self.communicator(await sync_to_async(realtime.issue_ticket)(self.user.pk))
        self.assertTrue((await second_tab.connect())[0])
        await first_tab.disconnect()
        self.assertTrue(await watcher.receive_nothing())
        self.assertTrue(await sync_to_async(realtime.is_online)(self.user.pk))

        await second_tab.disconnect()
        event = await watcher.receive_json_from()
        self.assertFalse(event['data']['online'])
        self.assertFalse(await sync_to_async(realtime.is_online)(self.user.pk))
        await watcher.disconnect()
