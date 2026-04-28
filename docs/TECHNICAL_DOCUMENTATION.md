# Technical Documentation

## 1. Purpose and Audience

This document is the developer-facing reference for the Incel Portal codebase. It is intended for:

- engineers onboarding to the project
- developers implementing new features
- maintainers handling bug fixes and refactors
- reviewers validating architecture and behavior consistency

Use this guide together with the project overview in the root README.

## 2. System Overview

Incel Portal is a monorepo with two runtime applications:

- Backend API: Django + Django REST Framework
- Frontend App: Next.js App Router + React

The platform provides role-aware internal workspace capabilities:

- authentication and session management
- application access and admin controls
- task assignment, tracking, comments, and timeline
- in-app notifications and optional browser push alerts
- audit log visibility for governance
- organization metadata (roles/departments)

## 3. Repository Structure

```text
incel-portal/
├── api/                        # Django backend
│   ├── portalapi/              # Django project config (settings/urls)
│   ├── accounts/               # auth, user profile and admin user endpoints
│   ├── applications/           # application catalog + admin operations + audit
│   ├── organization/           # departments and roles endpoints
│   ├── tasks/                  # task domain (task + activity timeline)
│   ├── common/                 # shared exception handling and helpers
│   ├── scripts/                # data seeding and utilities
│   └── requirements.txt
├── portal/                     # Next.js frontend
│   ├── app/                    # App Router pages and layouts
│   ├── components/             # reusable UI and skeletons
│   ├── lib/                    # API client, auth token helpers, domain clients
│   └── package.json
├── docs/                       # developer-focused documentation
├── deployment/                 # deployment bootstrap scripts (SQL, etc.)
├── docker-compose.yml          # production app compose stack
├── DEPLOYMENT.md               # VPS/infra deployment guide
└── README.md                   # project overview and setup
```

## 4. Backend Architecture

### 4.1 Runtime Stack

- Django 6
- Django REST Framework
- SimpleJWT
- PostgreSQL in normal runtime
- SQLite for tests
- WhiteNoise static serving
- boto3 for S3-compatible logo uploads

### 4.2 Django Project Wiring

- Root URLs in api/portalapi/urls.py
- API base path mounted at /api/v1/
- Health endpoint at /health/
- Domain route aggregator in api/portalapi/api_urls.py

### 4.3 Domain Apps and Responsibilities

1. accounts

- login/logout/refresh/change-password
- current user profile and permissions endpoints
- authenticated users listing
- admin user lifecycle updates (role, department, status)

2. organization

- list departments
- list roles

3. applications

- read application catalog
- open/can-access checks
- admin create/update/delete
- signed upload URL generation for logos
- per-application department mapping and user overrides
- admin audit log listing/detail

4. tasks

- task CRUD scoped by assigner/assignee participation
- backend filtering and pagination for lists
- status transition business rules
- task activity timeline (created/status_change/comment)
- task comments endpoint

5. notifications

- in-app notification storage and read state
- unread-count and paginated notification APIs
- user push subscription registration/deletion
- optional web push dispatch through VAPID + pywebpush

6. common

- standardized exception response envelope

### 4.4 Authentication and Permissions

Authentication classes:

- JWTAuthentication
- SessionAuthentication

Default permission class:

- IsAuthenticated

Object-level permissions are layered in domain view logic. For tasks, IsTaskAssignedOrAssigner ensures only involved users (assigner or assignee) can access details/actions.

### 4.5 Error Response Contract

The backend uses a custom DRF exception handler in api/common/exceptions.py.

Validation errors are wrapped as:

```json
{
  "error": {
    "type": "validation_error",
    "message": "Validation failed.",
    "details": {
      "field": ["message"]
    }
  }
}
```

Other API errors are wrapped similarly with type values such as authentication_error, authorization_error, and not_found.

Frontend and tests should parse error.error.message and error.error.details where applicable.

### 4.6 Task Domain Deep Dive

Key model concepts:

- Task: title, description, assigned_by, assigned_to, status, priority, deadline, completed_at
- TaskActivity: task, user, activity_type, old_value, new_value, comment, created_at

Activity types currently in use:

- created
- status_change
- comment

Business rules:

- only assignee can change status progression
- status cannot regress back to pending once started
- deadline cannot be in the past on create/update validation paths
- deadline required on task creation
- comments allowed for both assigner and assignee
- comments are capped at 200 characters
- comments remain allowed after task completion
- assignment/status/comment events emit user notifications

List behavior:

- view filter (assigned, created)
- status filter (comma-separated)
- priority filter (comma-separated)
- server-side pagination (20 items per page)

### 4.7 Applications Domain Deep Dive

Highlights:

- supports restricted and all-authenticated access modes
- supports visibility settings and status lifecycle
- supports user overrides for allow/deny
- integrates logo upload by generating signed URLs
- records audit logs for governance and tracing

### 4.8 Data and Migrations

- Django migrations are tracked per app
- production runtime expects PostgreSQL
- tests can run quickly with SQLite fallback in settings testing mode
- never alter historical migrations unless absolutely required
- add new migrations for any schema change and include them in PRs

### 4.9 Notifications Domain Deep Dive

Key model concepts:

- Notification: recipient, actor, notification_type, title, body, link_url, payload_json, is_read, read_at
- PushSubscription: user, endpoint, p256dh, auth, user_agent, is_active

Delivery flow:

- domain events call notifications.services.create_notification
- a Notification row is always created for in-app history
- if VAPID settings are configured and active subscriptions exist, push is sent
- subscriptions returning 404/410 are soft-disabled (is_active=False)

Current task event emitters:

- task assignment notifications on task creation
- task status change notifications to assigner and assignee
- comment notifications to the opposite participant

## 5. Frontend Architecture

### 5.1 Runtime Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- shadcn-style UI primitives
- Sonner for toast feedback
- date-fns for date/time formatting

### 5.2 Route Map

Public:

- / (login)

Protected (under app/(portal)):

- /dashboard
- /applications
- /tasks
- /tasks/[id]
- /logs

Shared header component:

- notification center bell with unread badge
- on-demand notification sidebar with outside-click close
- mark-read and clear actions for individual notifications
- mark-all-read and clear-all actions
- daily auto prompt for users without push subscription

### 5.3 Auth and API Client Pattern

Auth token storage:

- localStorage keys for access and refresh tokens

HTTP client behavior (portal/lib/api-client.ts):

- request interceptor injects Bearer access token
- response interceptor handles 401
- refresh token request sent to /auth/refresh
- retry original request with new access token
- clear tokens and redirect to login on refresh failure

### 5.4 UI Composition Pattern

Common page shape across portal pages:

- loading skeleton component while fetch in progress
- error card for blocking load failures
- toasts for non-blocking operation feedback
- section cards for summary/action/details

This pattern should be maintained for consistency and user trust.

### 5.5 Tasks Frontend Pattern

Task list page:

- server-driven filtering
- infinite scroll pagination
- skeleton loading for list states

Task detail page:

- status control card
- comment composer with character counter (200 max)
- success and failure toast notifications for comment posting
- unified activity timeline showing created/status/comment events

### 5.7 Notifications Frontend Pattern

Key implementation files:

- portal/components/notification-center.tsx
- portal/lib/api/notifications.ts
- portal/public/sw.js

Behavior:

- polls unread count every 30 seconds
- lazy-loads paginated notifications when sidebar opens
- supports infinite scroll pagination in sidebar
- allows mark one/mark all read operations
- allows clear one/clear all operations
- auto-checks browser subscription on app entry
- prompts once per day if user is not subscribed and permission is not denied
- supports browser push subscription upsert through API
- handles service-worker push click navigation back into the portal

### 5.6 Dashboard Pattern

Current dashboard is task-forward for both admin and non-admin users:

- personal task workload metrics first
- system-wide metrics for admins as secondary context
- applications still visible but no longer primary emphasis

## 6. API Reference (Developer-Oriented)

Base URL:

- local: http://127.0.0.1:8000/api/v1
- production: configured by environment

### 6.1 Auth

- POST /auth/login
- POST /auth/logout
- POST /auth/refresh
- POST /auth/change-password

### 6.2 User Context

- GET /me
- GET /me/permissions
- GET /me/applications

### 6.3 Users/Admin

- GET /users
- GET /admin/users
- GET /admin/users/{user_id}
- PATCH /admin/users/{user_id}/role
- PATCH /admin/users/{user_id}/department
- PATCH /admin/users/{user_id}/status

### 6.4 Organization

- GET /organization/departments
- GET /organization/roles

### 6.5 Applications

- GET /applications
- GET /applications/{application_id}
- GET /applications/{application_id}/can-access
- GET /applications/{application_id}/open
- POST /admin/applications
- POST /admin/applications/logo-upload-url
- PATCH/DELETE /admin/applications/{application_id}
- GET/POST /admin/applications/{application_id}/departments
- POST /admin/applications/{application_id}/overrides
- DELETE /admin/applications/{application_id}/overrides/{override_id}
- GET /admin/audit-logs
- GET /admin/audit-logs/{log_id}

### 6.6 Tasks

- GET /tasks
- POST /tasks
- GET /tasks/{id}
- PATCH /tasks/{id}
- GET /tasks/{id}/activities
- POST /tasks/{id}/comments

Comment constraints:

- required, non-empty after trim
- max 200 characters

### 6.7 Notifications

- GET /notifications
- GET /notifications/unread-count
- POST /notifications/{notification_id}/read
- DELETE /notifications/{notification_id}
- POST /notifications/read-all
- DELETE /notifications/clear-all
- GET /notifications/push-public-key
- GET /notifications/subscriptions
- POST /notifications/subscriptions
- DELETE /notifications/subscriptions/{subscription_id}

Push subscription write payload:

```json
{
  "subscription": {
    "endpoint": "https://...",
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  },
  "user_agent": "Mozilla/5.0 ..."
}
```

## 7. Local Development Workflow

### 7.1 Backend

```bash
cd api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

### 7.2 Frontend

```bash
cd portal
npm install
npm run dev
```

### 7.3 Required Environment Variables

Backend (api/.env expected by settings):

- DJANGO_SECRET_KEY
- DJANGO_DEBUG
- DJANGO_ALLOWED_HOSTS
- CORS_ALLOWED_ORIGINS
- DB_NAME
- DB_USER
- DB_PASSWORD
- DB_HOST
- DB_PORT
- AWS_S3_BUCKET_NAME
- AWS_S3_REGION_NAME
- AWS_S3_CUSTOM_DOMAIN
- AWS_S3_ENDPOINT_URL
- AWS_APPLICATION_LOGO_S3_PREFIX
- AWS_APPLICATION_LOGO_UPLOAD_URL_EXPIRES_IN
- AWS_S3_OBJECT_ACL
- WEB_PUSH_VAPID_PUBLIC_KEY
- WEB_PUSH_VAPID_PRIVATE_KEY
- WEB_PUSH_VAPID_SUBJECT

Frontend (portal/.env.local or shell env):

- NEXT_PUBLIC_API_BASE_URL

## 8. Testing and Quality Gates

### 8.1 Backend Quality

Typical checks:

```bash
cd api
source .venv/bin/activate
python manage.py check
python manage.py test
```

Feature-level expectation:

- add tests for new business rules
- add permission tests for any new sensitive endpoint
- add regression tests whenever a bug is fixed

### 8.2 Frontend Quality

```bash
cd portal
npm run lint
npm run build
```

Feature-level expectation:

- preserve page loading and error states
- include user feedback toasts for async actions
- keep route-level behavior consistent with role/access constraints

### 8.3 CI Pipeline

GitHub workflow in .github/workflows/ci-cd.yml:

- backend tests with Postgres service
- frontend lint + build
- docker image build and push to GHCR

No image publish step should proceed if tests fail.

## 9. Deployment and Operations

Production model:

- root docker-compose.yml deploys app stack (backend + frontend)
- external Traefik handles ingress and TLS
- shared Postgres expected from infrastructure stack
- GHCR images consumed for backend/frontend runtime

Refer to DEPLOYMENT.md for VPS step-by-step operations and environment file examples.

## 10. Common Change Scenarios

### 10.1 Adding a new backend endpoint

1. Add serializer/input validation
2. Add view logic + permissions
3. Wire route in relevant api_urls
4. Add tests for success + failure + unauthorized behavior
5. Update docs in README and docs/TECHNICAL_DOCUMENTATION.md

### 10.2 Adding a new frontend page

1. Add route in app/ tree
2. Reuse existing loading/error/skeleton patterns
3. Integrate with typed API client functions
4. Add toast feedback for user-triggered mutations
5. Update docs in README and docs/TECHNICAL_DOCUMENTATION.md

### 10.3 Modifying task workflow rules

1. Update serializer validation and view behavior
2. Ensure timeline/audit semantics remain coherent
3. Update backend tests to lock expected behavior
4. Verify frontend pages still align with new constraints
5. Update docs to record new/removed rules and endpoint behavior

## 11. Security and Data Handling Notes

- Keep secrets out of source control
- Use env files for local/production secrets
- Keep JWT refresh handling strict and fail-closed
- Validate all mutating input server-side even if validated on UI
- Avoid exposing admin operations in non-admin frontend paths
- Keep audit logging for operationally relevant actions

## 12. Documentation Maintenance Contract

Developer rule for this repository:

- every API or frontend feature that is added, removed, or modified must also update documentation in the same change set

Minimum documentation update requirement per feature PR:

1. Update root README if user-facing behavior changed
2. Update this technical documentation for architecture or workflow changes
3. Update endpoint lists and constraints if API contract changed
4. Update setup/deployment sections if runtime requirements changed

If documentation is not updated for behavior changes, the change is incomplete.

## 13. Recommended Next Docs (Optional)

If the team grows, split this document into focused references:

- docs/API_CONTRACT.md
- docs/FRONTEND_ARCHITECTURE.md
- docs/BACKEND_ARCHITECTURE.md
- docs/CONTRIBUTING.md
- docs/TROUBLESHOOTING.md

For now, this file intentionally keeps everything in one comprehensive location.
