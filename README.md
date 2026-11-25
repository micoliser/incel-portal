# Incel Portal

Incel Portal (Incel Workspace) is the internal staff portal for Incel Group. Staff
sign in once to manage tasks, to-dos, daily reports and weekly summaries, open
the company's internal applications, raise support requests, and see the
company assets assigned to them. Administrators manage users, the organization
structure, applications and the asset register; executives get a read-only
view across the whole company.

The repository is a monorepo with two applications:

- `api/`: Django REST API, with Celery workers for emails, notifications and
  scheduled jobs.
- `portal/`: Next.js web app used in the browser.

Developer detail (architecture, API contract, rules, operations) is in
[docs/TECHNICAL_DOCUMENTATION.md](docs/TECHNICAL_DOCUMENTATION.md). The guide
for staff is [docs/USER GUIDE.md](docs/USER%20GUIDE.md).

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Running locally](#running-locally)
- [Configuration](#configuration)
- [Tests and quality checks](#tests-and-quality-checks)
- [CI/CD and deployment](#cicd-and-deployment)
- [Management commands](#management-commands)
- [Contributing](#contributing)

## Features

**Accounts and sign-in**
- Email and password sign-in. Sessions are kept in HttpOnly cookies, never
  readable by page scripts.
- New users are emailed a link to choose their own password (valid 72 hours).
  Administrators never set or see passwords; they can send a reset link.
- Forgot-password links by email (valid one hour, at most three emails an hour
  per account).
- Ten wrong passwords lock that email from that network for 15 minutes; the
  sign-in page shows how many attempts remain.
- Signing out everywhere else after a password change or reset, and
  immediately ending a disabled user's sessions.
- Automatic sign-out after an hour of inactivity.

**Work**
- Tasks: create for one person or up to 50 at once, status flow
  Pending → In Progress → Under Review → Completed, approval or rejection by the
  assigner, comments with files and links, full activity history, drafts.
- Recurring tasks: daily or weekly schedules that create tasks automatically,
  with edit, pause, resume and end.
- To-dos: personal list with due dates, priorities, reminders and snooze.
- Goals: weekly targets against summary metrics.
- Daily reports: one report per person per day with entries and comments,
  visible to the department; forward by email.
- Weekly summaries: generated every Monday with week-over-week comparison;
  share with a colleague or by a public link (shown once, expires after 30
  days); export to PDF. Organization-wide summary for executives.

**Applications**
- Catalogue of internal applications with per-department access, per-person
  allow or deny exceptions, and recently opened apps.
- Hidden applications are visible only to administrators; an application's
  address is only given to people who may open it.

**Support**
- Requests routed automatically (IT support to the IT department, everything
  else to HR), assignment by the department's line manager, status updates,
  replies with attachments, confirmation by the requester, automatic closing
  seven days after resolution.

**Inventory**
- Asset register with categories, photos, assignment to a person or a
  department, returns, maintenance logs with attachments, CSV export, and a
  "My assets" page for everyone. Managed by the department marked as
  responsible for assets (IT).

**Administration**
- Users (create, edit, enable or disable, send reset link), the organization
  tree (departments, units, teams and their leaders), applications and access
  rules, audit log of sign-ins and every administrative change.

**Chat**
- One-to-one chat between any two staff, with photos, videos and files up to
  25 MB. End-to-end encrypted: nobody but the two people, including IT and
  admins, can read messages or files. Chat is unlocked with a 6-digit PIN
  together with the portal password, and each person keeps a recovery code.
- Live delivery, read receipts ("Seen"), typing and online status, replies,
  edit and delete for everyone within 30 minutes, delete for me at any time.
- A full page at `/chat` and a slide-up chat drawer on every page.
- Design: [docs/CHAT_SPEC.md](docs/CHAT_SPEC.md).

**Notifications**
- In-app notification centre, emails, and optional browser push.

Who can do what is listed in
[docs/TECHNICAL_DOCUMENTATION.md](docs/TECHNICAL_DOCUMENTATION.md#5-access-control).

## Architecture

| Part | Technology |
|---|---|
| Web app | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, axios |
| API | Django 6.0, Django REST Framework 3.16, SimpleJWT 5.5 (tokens in HttpOnly cookies) |
| Background work | Celery 5 worker and Celery beat, Redis as broker |
| Data | PostgreSQL (SQLite for local test runs) |
| Cache | Redis (sign-in lockouts, rate limits, job locks) |
| Files | Amazon S3; browsers upload directly with presigned URLs |
| Hosting | CapRover on a single server behind Cloudflare; images on GHCR |

The API is mounted at `/api/v1`. Routes have no trailing slash, every list is
paginated the same way, and every error has the same JSON shape; see the
technical documentation.

The application's business time zone is Africa/Lagos: it decides what
"today" is and when scheduled jobs run. Timestamps are stored in UTC.

## Repository layout

```text
incel-portal/
├── api/                       Django API
│   ├── portalapi/             settings, URLs, Celery app
│   ├── accounts/              sign-in, sessions, users, service API keys
│   ├── organization/          departments, units, teams, roles
│   ├── applications/          application catalogue, access rules, audit log
│   ├── tasks/                 tasks, recurring schedules, to-dos, goals,
│   │                          daily reports, weekly summaries
│   ├── support/               support requests
│   ├── inventory/             assets, assignments, maintenance
│   ├── notifications/         in-app notifications and browser push
│   ├── chat/                  end-to-end encrypted chat (REST + WebSocket)
│   ├── emails/                email templates, sending, email log
│   ├── common/                shared code (permissions, pagination, storage,
│   │                          cache, request parsing, errors)
│   └── <app>/tests/           tests, one package per app
├── portal/                    Next.js web app
│   ├── app/                   pages (app/(portal)/ is the signed-in area)
│   ├── components/            shared UI
│   ├── lib/api/               one module per API area
│   ├── public/sw.js           service worker for browser push
│   └── e2e/                   Playwright end-to-end tests
├── docs/                      technical documentation, user guide, policy
└── .github/workflows/         CI/CD
```

## Running locally

### Prerequisites

- Python 3.12, Node.js 22, PostgreSQL 16 or newer, Redis.
- An S3 bucket and AWS key if you want to try uploads.

### 1. API

```bash
cd api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create the database (once):

```bash
sudo -u postgres createuser -P incel_portal_user
```

```bash
sudo -u postgres createdb -O incel_portal_user incel_portal_db
```

Create `api/.env` (see [Configuration](#configuration)), then:

```bash
python manage.py migrate
```

```bash
python manage.py createsuperuser
```

```bash
python manage.py runserver 127.0.0.1:8000
```

`runserver` does not serve the chat WebSocket. To use chat locally, also run
the realtime app on another port and point the web app at it with
`NEXT_PUBLIC_CHAT_WS_URL=ws://localhost:8001`:

```bash
python -m uvicorn portalapi.asgi:application --host 127.0.0.1 --port 8001
```

For chat, both processes must share `CACHE_URL` and `CHANNEL_LAYER_URL`
(Redis), since tickets and live events pass between them. Alternatively,
serve everything from uvicorn on port 8000 instead of `runserver`.

### 2. Background workers

Emails, browser pushes and scheduled jobs run in Celery. In two more terminals,
from `api/` with the virtual environment active:

```bash
python -m celery -A portalapi worker --loglevel=info
```

```bash
python -m celery -A portalapi beat --loglevel=info
```

Without a worker, set `SEND_EMAILS_CELERY=False` and `SEND_PUSH_CELERY=False`
so emails and pushes are sent from the API process instead.

### 3. Web app

```bash
cd portal
npm install
```

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1 npm run dev
```

Open http://localhost:3000 and sign in with the superuser.

Use the same host name (`localhost` or `127.0.0.1`) for the web app and the
API, and include the web app's address in `CORS_ALLOWED_ORIGINS`: the API
refuses changes from any other origin.

## Configuration

The API reads `api/.env` (or real environment variables). A local development
file:

```dotenv
DJANGO_SECRET_KEY=any-long-random-string
DJANGO_DEBUG=True
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
CSRF_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
PORTAL_BASE_URL=http://localhost:3000

DB_NAME=incel_portal_db
DB_USER=incel_portal_user
DB_PASSWORD=your-local-password
DB_HOST=127.0.0.1
DB_PORT=5432

CELERY_BROKER_URL=redis://127.0.0.1:6379/0

# Chat (only needed when the API and realtime app are separate processes).
CACHE_URL=redis://127.0.0.1:6379/14
CHANNEL_LAYER_URL=redis://127.0.0.1:6379/13

# Print emails to the worker log instead of sending them.
EMAIL_ENABLED=True
EMAIL_DEBUG=True

# Optional: uploads.
AWS_S3_BUCKET_NAME=
AWS_S3_REGION_NAME=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Optional: browser push.
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_VAPID_SUBJECT=mailto:you@example.com
```

Outside debug mode the API refuses to start without `DJANGO_SECRET_KEY` and
`DB_PASSWORD`.

The web app needs `NEXT_PUBLIC_API_BASE_URL` at build time, and
`NEXT_PUBLIC_CHAT_WS_URL` (the realtime app's address) when chat runs on a
different host from the API.

Every setting, its default and what it does is listed in
[docs/TECHNICAL_DOCUMENTATION.md](docs/TECHNICAL_DOCUMENTATION.md#11-configuration-reference).
The ones that matter most in production:

| Variable | Purpose |
|---|---|
| `CACHE_URL` | Redis for lockouts, rate limits and job locks. Use a different database number from Celery's. If Redis cannot be reached the API keeps working without these protections and `/health/` reports `degraded`. |
| `TRUSTED_PROXY_COUNT` | Proxies in front of the API (production: `2`, Cloudflare then CapRover's nginx). Decides the client address used for lockouts, the admin IP allowlist and the audit log. |
| `CHANNEL_LAYER_URL` | Redis database for chat's live delivery, shared by the API and the realtime app. |
| `PORTAL_BASE_URL` | Address used in emailed links. |
| `*_S3_PREFIX` | Folder in the bucket for each kind of upload; the AWS key must be allowed to read, write and delete there. |

## Tests and quality checks

### API

From `api/` with the virtual environment active:

```bash
python manage.py test
```

```bash
uvx ruff check .
```

```bash
python manage.py makemigrations --check --dry-run
```

Tests use SQLite by default. To run them on Postgres, as CI does:

```bash
TEST_USE_SQLITE=false python manage.py test
```

`common/tests/test_rbac_matrix.py` checks who may call every role-gated
endpoint; update it with any change to access rules.

### Web app

From `portal/`:

```bash
npm run lint
```

```bash
npm run build
```

### End to end

Playwright drives the real web app against the real API and a dedicated
Postgres database. Setup and options are in
[portal/e2e/README.md](portal/e2e/README.md). From `portal/`:

```bash
npm run test:e2e
```

## CI/CD and deployment

`.github/workflows/ci-cd.yml` runs on every pull request into `main` and every
push to `main`:

1. Backend: ruff, `manage.py check`, missing-migration check, tests on
   Postgres.
2. Frontend: lint and production build.
3. End to end: the full Playwright suite.
4. On `main` only, if all pass: build the API and web images, tag them with
   the commit SHA, push to GHCR, and deploy that exact image to the four
   CapRover apps (API, Celery worker, Celery beat, web app).

A newer push to a pull request cancels the older run; runs on `main` queue so
a deployment is never interrupted. To roll back, redeploy an earlier commit's
image in CapRover (database changes may also need restoring from backup).

Production runs on CapRover behind Cloudflare. The API container runs
migrations on start. Operational detail (apps, environment, health checks,
backups) is in
[docs/TECHNICAL_DOCUMENTATION.md](docs/TECHNICAL_DOCUMENTATION.md#13-deployment-and-operations).

## Management commands

Run from `api/`:

| Command | Purpose |
|---|---|
| `python manage.py create_service_api_key --name "Other system" [--scope users:read]` | Create a key for another system to call `GET /api/v1/external/users`. The key is shown once. |
| `python manage.py import_users_from_csv users.csv [--send-links]` | Create departments and users from a CSV; `--send-links` emails each new user a set-password link. |
| `python manage.py generate_user_summaries --weeks N [--user-id ID]` | Rebuild weekly summaries. |
| `python manage.py recalculate_weekly_summaries --weeks N` | Recalculate the last N finished weeks (default 4) with their comparisons and the organization view, after a change to how summaries are calculated. Sends no emails. |
| `python manage.py delete_weekly_summaries [--week-start-date YYYY-MM-DD] [--user-id ID]` | Delete the weekly summaries of one week (default: the week in progress). |
| `python manage.py test_emails --type user_created --email you@example.com` | Send one test email of a given type to check templates and delivery. |
| `python manage.py compress_s3_images` | Compress stored inventory photos. |
| `python manage.py seed_e2e` | Load the end-to-end test data. Only runs against a database whose name ends in `_e2e`, which it wipes. |

## Contributing

- Follow [docs/DOCUMENTATION_POLICY.md](docs/DOCUMENTATION_POLICY.md): a change
  to behaviour, the API contract, setup or deployment is not finished until
  this README and the technical documentation describe it.
- Keep the API conventions: no trailing slashes, `search` for text search,
  `<name>_id` for references, the shared pagination and error shapes, `PATCH`
  for partial updates (no `PUT`).
- Add a backend test for every new rule or fixed bug, and update the role test
  when access rules change.
- Keep the portal's API calls in `portal/lib/api/`.
