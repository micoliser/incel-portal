# Incel Portal

Incel Portal is a role-aware internal portal for managing applications, tasks, users, departments, and audit activity from a single workspace.

The repository is organized as a monorepo with two main apps:

- `api/` - Django REST API that powers authentication, users, applications, tasks, organization metadata, and audit logs.
- `portal/` - Next.js frontend that provides the browser UI for the portal.

The system is built for authenticated users only. Users sign in with email and password, receive JWT tokens, and then access the portal dashboard, applications, tasks, and logs based on their permissions.

## What This Project Does

The portal is designed to centralize internal work and access control. It lets users:

- sign in securely
- view their dashboard
- browse and open internal applications
- create, update, and track tasks
- add comments and follow task activity history
- inspect audit logs
- manage users, departments, and roles through admin endpoints

It also supports access control logic based on role, department, global access, and application-level overrides.

## High-Level Architecture

The application has three main layers:

1. Frontend UI

- Built with Next.js 16 and React 19
- Uses client-side authentication tokens stored in the browser
- Talks to the backend through a configurable API base URL

2. Backend API

- Built with Django 6 and Django REST Framework
- Uses JWT authentication via SimpleJWT
- Uses PostgreSQL in normal runtime and SQLite for tests
- Serves both data APIs and admin endpoints

3. Infrastructure

- Production deployment uses Docker Compose, Traefik, GHCR images, WhiteNoise for static files, and S3-compatible storage for application logos

## Repository Layout

```text
incel-portal/
├── api/                    # Django backend
├── portal/                 # Next.js frontend
├── deployment/             # VPS/bootstrap SQL and deployment helpers
├── docker-compose.yml      # Production app stack
├── DEPLOYMENT.md           # Production deployment guide
├── .env.backend             # Backend environment variables
├── .env.frontend            # Frontend environment variables
└── README.md               # This file
```

## Main Product Features

### Authentication and session management

- Email/password sign-in
- JWT access and refresh tokens
- Logout endpoint that invalidates refresh tokens
- Password change support
- Session-aware frontend routing
- Automatic redirect to the login page when tokens are missing or invalid

### Dashboard

- Role-aware dashboard content
- Task-focused summary cards
- Admin and non-admin views both emphasize personal assigned tasks
- Quick actions to applications and tasks
- Recent task snapshot panels
- Application snapshot panels

### Applications

- Browse applications available to the current user
- Open application details
- Check whether a user can access a specific application
- Open application links through the portal
- Admins can create, edit, update, and delete applications
- Admins can upload logos through signed upload URLs
- Admins can manage access scope, department restrictions, and per-user overrides

### Tasks

- Create tasks
- View assigned tasks and created tasks
- Filter tasks by view, status, and priority
- Server-side pagination for task lists
- Infinite scroll in the frontend task list
- Task detail page with metadata and status controls
- Status transitions with business rules
- Task activity timeline
- Comment support for assigner and assignee
- Timeline entries for created, status change, and comment events
- In-app notifications for assignment, status changes, and comments
- Optional browser push notifications with service-worker delivery
- Loading skeletons for list and detail views

### Notifications

- Notification center in the portal header
- Unread count badge and mark-as-read actions
- Mark all notifications as read
- Per-notification clear and clear-all actions
- Sidebar notification drawer with infinite scroll
- Browser push subscription auto-check on app entry
- Daily permission prompt for non-subscribed users
- Notification deep links back into task detail views

### Logs and audit trail

- Audit log viewing for admins
- Filtering audit logs by time and date range
- Action metadata inspection
- Useful for tracking user, task, and application changes

### Organization metadata

- Department listing
- Role listing
- Department-aware access logic for users and applications

### Admin controls

- Admin user listing and detail management
- Role assignment and updates
- Department assignment and updates
- User activation/deactivation
- Audit log access
- Application lifecycle management

## Frontend Application

The frontend lives in `portal/` and uses the Next.js App Router.

### Frontend tech stack

- Next.js 16.2.3
- React 19.2
- TypeScript
- Tailwind CSS 4
- shadcn/ui-style component primitives
- Lucide icons
- Sonner for toast notifications
- date-fns for date formatting and relative time

### Frontend routes

- `/` - login page
- `/dashboard` - portal overview
- `/applications` - application browser and admin management tools
- `/tasks` - task list with filters and infinite scroll
- `/tasks/[id]` - task detail, status controls, comments, and activity timeline
- `/logs` - audit log viewer

### Frontend behavior

- Auth tokens are stored client-side after successful login
- The layout protects portal routes and redirects unauthenticated users back to the login page
- The theme can be toggled between light and dark mode
- The UI uses loading skeletons and toast notifications for better feedback
- Tasks and applications are fetched from the backend API, not hardcoded
- Notification center polls unread counts and loads full notifications on demand
- Browser push is enabled via a service worker at `portal/public/sw.js`

## Backend API

The backend lives in `api/` and exposes all portal data and admin actions.

### Backend tech stack

- Django 6.0.4
- Django REST Framework 3.16
- SimpleJWT for authentication
- PostgreSQL in normal runtime
- SQLite for test execution
- WhiteNoise for static files
- boto3 for S3-compatible logo uploads
- django-cors-headers for cross-origin frontend access
- pywebpush for browser push delivery

### API base path

All API routes are mounted under:

```text
/api/v1/
```

There is also a health endpoint at:

```text
/health/
```

### Core API domains

#### Authentication and session

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/change-password`

#### Current user context

- `GET /api/v1/me`
- `GET /api/v1/me/permissions`
- `GET /api/v1/me/applications`

#### Users and admin user management

- `GET /api/v1/users`
- `GET /api/v1/admin/users`
- `GET /api/v1/admin/users/{id}`
- `PATCH /api/v1/admin/users/{id}/role`
- `PATCH /api/v1/admin/users/{id}/department`
- `PATCH /api/v1/admin/users/{id}/status`

#### Organization

- `GET /api/v1/organization/departments`
- `GET /api/v1/organization/roles`

#### Applications

- `GET /api/v1/applications`
- `GET /api/v1/applications/{id}`
- `GET /api/v1/applications/{id}/can-access`
- `GET /api/v1/applications/{id}/open`
- `POST /api/v1/admin/applications`
- `POST /api/v1/admin/applications/logo-upload-url`
- `PATCH/DELETE /api/v1/admin/applications/{id}`
- `GET/POST /api/v1/admin/applications/{id}/departments`
- `POST /api/v1/admin/applications/{id}/overrides`
- `DELETE /api/v1/admin/applications/{id}/overrides/{override_id}`
- `GET /api/v1/admin/audit-logs`
- `GET /api/v1/admin/audit-logs/{id}`

#### Tasks

- `GET /api/v1/tasks`
- `POST /api/v1/tasks`
- `GET /api/v1/tasks/{id}`
- `PATCH /api/v1/tasks/{id}`
- `GET /api/v1/tasks/{id}/activities`
- `POST /api/v1/tasks/{id}/comments`

#### Notifications

- `GET /api/v1/notifications`
- `GET /api/v1/notifications/unread-count`
- `POST /api/v1/notifications/{id}/read`
- `DELETE /api/v1/notifications/{id}`
- `POST /api/v1/notifications/read-all`
- `DELETE /api/v1/notifications/clear-all`
- `GET /api/v1/notifications/push-public-key`
- `GET/POST /api/v1/notifications/subscriptions`
- `DELETE /api/v1/notifications/subscriptions/{id}`

### Task API behavior

The task subsystem supports a richer workflow than basic CRUD:

- tasks are visible only to the assigner and assignee
- task lists support `view`, `status`, `priority`, and page query parameters
- task lists are paginated server-side
- the assignee controls status progression
- progress cannot be moved backward to pending once started
- completed tasks get a completion timestamp
- task activities log creation, status changes, and comments
- comments can be added by the assigner or assignee
- comments remain available after completion
- assignment, status changes, and comments emit notifications

### Notification API behavior

The notification subsystem supports both in-app and browser push workflows:

- users can fetch paginated notifications scoped to themselves
- users can read single notifications or mark all as read
- users can clear single notifications or clear all notifications
- unread counts are optimized through a lightweight endpoint
- users can register push subscriptions (endpoint + keys)
- frontend auto-checks browser subscription on app entry
- if not subscribed, permission can be requested once per day
- push delivery is sent when VAPID settings are configured
- stale subscriptions are deactivated automatically on 404/410 push responses

### Commenting model

Task comments are stored as task activities rather than a separate comment table.

That means:

- a single activity timeline powers all task history
- comments, creation events, and status changes appear in one chronological feed
- the frontend only needs one timeline renderer

### Application access model

Applications support multiple access patterns:

- fully open to authenticated users
- restricted by department
- restricted with user-level overrides
- admin management of application status and visibility

### Audit logging

The backend records audit events for important actions such as:

- task creation
- task status changes
- application and user management events

These logs are surfaced in the frontend audit log page for admin users.

## Local Development Setup

The project can be run with two separate apps:

- Django backend from `api/`
- Next.js frontend from `portal/`

### Prerequisites

- Python 3.12 or newer recommended
- Node.js 20 or newer recommended
- PostgreSQL if you want to run the backend in normal mode locally
- Access to the needed environment variables

### 1. Clone and enter the repo

```bash
git clone <repo-url>
cd incel-portal
```

### 2. Configure the backend environment

The backend reads environment variables from `api/.env`.

Minimum useful values:

```dotenv
DJANGO_SECRET_KEY=change-me
DJANGO_DEBUG=True
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
CORS_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000

DB_NAME=incel_portal_db
DB_USER=incel_portal_user
DB_PASSWORD=change-this-password
DB_HOST=127.0.0.1
DB_PORT=5432

AWS_S3_BUCKET_NAME=
AWS_S3_REGION_NAME=
AWS_S3_CUSTOM_DOMAIN=
AWS_S3_ENDPOINT_URL=
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_VAPID_SUBJECT=mailto:admin@localhost
```

The backend settings file is in `api/portalapi/settings.py`.

### 3. Configure the frontend environment

The frontend reads environment variables from `portal/.env.local` or your shell environment.

Minimum value:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1
```

### 4. Install backend dependencies

```bash
cd api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 5. Install frontend dependencies

```bash
cd ../portal
npm install
```

### 6. Run backend migrations

```bash
cd ../api
source .venv/bin/activate
python manage.py migrate
```

### 7. Start the backend

```bash
cd api
source .venv/bin/activate
python manage.py runserver 127.0.0.1:8000
```

### 8. Start the frontend

```bash
cd portal
npm run dev
```

Open the app at:

```text
http://127.0.0.1:3000
```

## Docker Compose / Production Setup

The root `docker-compose.yml` is designed for the production app stack.

It expects:

- an existing external Docker network named `web`
- a shared Postgres service in the infrastructure stack
- backend and frontend images from GHCR
- `.env.backend` and `.env.frontend` beside the compose file

The production stack uses:

- backend container that runs migrations, collects static files, and starts Gunicorn
- frontend container configured with the public API base URL
- Traefik labels for routing and TLS

See `DEPLOYMENT.md` for a full VPS deployment workflow.

## Running Tests

### Backend tests

From `api/`:

```bash
source .venv/bin/activate
python manage.py test
```

### Frontend lint

From `portal/`:

```bash
npm run lint
```

### Frontend production build

From `portal/`:

```bash
npm run build
```

## Demo Data

There is a seed script at:

```text
api/scripts/seed_demo_data.py
```

It can:

- log in as an admin user
- create test users across departments
- create sample applications with randomized access rules
- upload application logos through signed S3 upload URLs

Example usage:

```bash
cd api
source .venv/bin/activate
python scripts/seed_demo_data.py
```

You can override the API base URL, admin login, password, logo path, and random seed through CLI flags.

## Environment Variables

### Backend

- `DJANGO_SECRET_KEY`
- `DJANGO_DEBUG`
- `DJANGO_ALLOWED_HOSTS`
- `CORS_ALLOWED_ORIGINS`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_HOST`
- `DB_PORT`
- `AWS_S3_BUCKET_NAME`
- `AWS_S3_REGION_NAME`
- `AWS_S3_CUSTOM_DOMAIN`
- `AWS_S3_ENDPOINT_URL`
- `AWS_APPLICATION_LOGO_S3_PREFIX`
- `AWS_APPLICATION_LOGO_UPLOAD_URL_EXPIRES_IN`
- `AWS_S3_OBJECT_ACL`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT`

### Frontend

- `NEXT_PUBLIC_API_BASE_URL`

### Production compose overrides

- `BACKEND_IMAGE`
- `FRONTEND_IMAGE`
- `PORTAL_APP_HOST`
- `PORTAL_API_HOST`

## Important Implementation Notes

- The frontend is a client-heavy Next.js app that fetches user context after route load.
- The backend uses JWT plus session authentication to support both browser sessions and API usage.
- The task detail page includes status transition controls and a comment composer.
- The dashboard intentionally emphasizes task information for both normal users and admins.
- The task activity timeline is a single source of truth for task history.
- File uploads for application logos use signed upload URLs rather than direct app server uploads.
- Audit logs are built into the product and should be considered part of the application’s core behavior, not an optional add-on.

## Useful Links in This Repo

- [Deployment guide](DEPLOYMENT.md)
- [Backend compose file](docker-compose.yml)
- [Demo data script](api/scripts/seed_demo_data.py)
- [Technical documentation](docs/TECHNICAL_DOCUMENTATION.md)
- [Documentation policy](docs/DOCUMENTATION_POLICY.md)

## Notes for Contributors

- Keep backend and frontend API contracts aligned.
- Preserve role-aware and department-aware access logic.
- When adding task behavior, update both the timeline and the API tests.
- Prefer server-side filtering for data-heavy pages.
- Add tests for new business rules rather than relying only on UI behavior.
