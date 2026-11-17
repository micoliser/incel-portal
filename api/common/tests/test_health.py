from unittest.mock import patch

from django.db.utils import OperationalError
from django.test import TestCase


class HealthCheckTests(TestCase):
    def test_healthy_when_the_database_answers(self):
        response = self.client.get('/health/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})

    def test_unavailable_when_the_database_does_not(self):
        with patch('portalapi.urls.connection') as connection:
            connection.cursor.side_effect = OperationalError('connection refused')
            response = self.client.get('/health/')
        self.assertEqual(response.status_code, 503)
