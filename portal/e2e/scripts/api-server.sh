#!/usr/bin/env bash
# Starts the Django API for the end-to-end suite against a dedicated database.
# It migrates, wipes and reseeds that database on every start, so each test run
# begins from the same data. Database host, user and password come from api/.env.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../../../api"

PYTHON="${E2E_PYTHON:-.venv/bin/python}"
WEB_ORIGIN="http://localhost:${E2E_WEB_PORT:-3100}"

export DB_NAME="${E2E_DB_NAME:-incel_portal_e2e}"
export DJANGO_DEBUG=True
export DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
export CORS_ALLOWED_ORIGINS="$WEB_ORIGIN"
export CSRF_TRUSTED_ORIGINS="$WEB_ORIGIN"
export PORTAL_BASE_URL="$WEB_ORIGIN"

# Emails are never sent and never queued to Celery. They are written as files
# to a mailbox directory, which the tests read (for example to follow the
# set-password link a new user is emailed). The mailbox is emptied on each start.
MAILBOX="$SCRIPT_DIR/../.mail"
rm -rf "$MAILBOX"
mkdir -p "$MAILBOX"
export EMAIL_ENABLED=True
export EMAIL_DEBUG=False
export SEND_EMAILS_CELERY=False
export EMAIL_BACKEND=django.core.mail.backends.filebased.EmailBackend
export EMAIL_FILE_PATH="$MAILBOX"

# No browser push and no real object storage: the endpoint below is unroutable,
# so any accidental S3 call fails immediately instead of reaching a real bucket.
export WEB_PUSH_VAPID_PUBLIC_KEY=
export WEB_PUSH_VAPID_PRIVATE_KEY=
export AWS_S3_BUCKET_NAME=e2e-bucket
export AWS_S3_ENDPOINT_URL=http://127.0.0.1:9
export AWS_S3_CUSTOM_DOMAIN=
export AWS_ACCESS_KEY_ID=e2e
export AWS_SECRET_ACCESS_KEY=e2e
# There is no storage to ask about an upload, so uploads are not verified.
export VERIFY_UPLOADS=False
export SEND_PUSH_CELERY=False

"$PYTHON" manage.py migrate --noinput
"$PYTHON" manage.py seed_e2e
# Served by uvicorn (ASGI) rather than runserver so the chat WebSocket works
# on the same port as the REST API. One worker keeps chat tickets and
# presence, which live in the in-process cache here, in one place.
exec "$PYTHON" -m uvicorn portalapi.asgi:application --host 127.0.0.1 --port "${E2E_API_PORT:-8100}" --workers 1 --lifespan off --log-level warning
