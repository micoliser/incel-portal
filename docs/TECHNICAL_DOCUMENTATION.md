# Technical Documentation

Developer reference for Incel Portal: how it is built, the API contract, the
rules the code enforces, and how it runs in production. Start with the root
[README](../README.md) for setup.

Last full review: 2026-11-17, after the security and consistency overhaul
(see section 15).

## Contents

1. [System overview](#1-system-overview)
2. [Repository structure](#2-repository-structure)
3. [Backend architecture](#3-backend-architecture)
4. [Authentication and sessions](#4-authentication-and-sessions)
5. [Access control](#5-access-control)
6. [API conventions](#6-api-conventions)
7. [API reference](#7-api-reference)
8. [Domain rules](#8-domain-rules)
9. [File uploads](#9-file-uploads)
10. [Background jobs, emails and notifications](#10-background-jobs-emails-and-notifications)
11. [Configuration reference](#11-configuration-reference)
12. [Frontend architecture](#12-frontend-architecture)
13. [Deployment and operations](#13-deployment-and-operations)
14. [Testing and quality gates](#14-testing-and-quality-gates)
15. [Change history of contract-breaking changes](#15-change-history-of-contract-breaking-changes)
16. [Common change scenarios](#16-common-change-scenarios)

---

## 1. System overview

| Component | Technology | Runs as |
|---|---|---|
| API | Django 6.0, DRF 3.16, SimpleJWT 5.5 | gunicorn, 3 workers |
| Background jobs | Celery 5 | one worker app and one beat app (same image as the API) |
| Web app | Next.js 16 App Router, React 19, TypeScript, Tailwind 4 | Next.js server |
| Database | PostgreSQL | shared Postgres container |
| Broker and cache | Redis | one Redis, separate database numbers for Celery and the cache |
| Files | Amazon S3 | browser uploads directly with presigned URLs |

Business time zone: Africa/Lagos (`TIME_ZONE`, from `APP_TIME_ZONE`). It
decides what "today" is and when beat jobs run. `USE_TZ = True`, so stored
timestamps are UTC.

## 2. Repository structure

```text
api/
├── portalapi/            settings.py, urls.py (health, admin, /api/v1), api_urls.py, celery.py
├── accounts/             sign-in, sessions, users, service API keys
│   ├── services.py       session revocation, password links, sign-in guard
│   └── tasks.py          token cleanup, audit-log pruning
├── organization/         Department, Unit, Team, Role; services.py (placement rules)
├── applications/         applications, access overrides, recent apps, the AuditLog model
├── audit/                audit logging code (no models; the table is applications.AuditLog)
│   ├── log.py            log_audit(), also importable as `audit.log_audit`
│   ├── actions.py        AuditAction constants (every action name)
│   └── messages.py       human-readable audit text
├── tasks/                tasks, recurring schedules, to-dos, goals, reports, summaries
│   ├── models/           one module per area: tasks, recurring, todos, goals, reports, summaries
│   ├── serializers/      the same areas
│   ├── services/         recurring, tasks, summaries, goals
│   ├── views_api/        tasks, recurring, todos, goals, reports, summaries
│   ├── permissions.py    task and schedule permissions, who-may-change rules
│   ├── hierarchy.py      manager and oversight helpers
│   └── tasks.py          Celery jobs
├── support/              support requests; services.py (routing, transitions)
├── inventory/            categories, items, assignments, maintenance logs
├── notifications/        Notification, PushSubscription, services.py, tasks.py
├── chat/                 encrypted chat: models, services.py, consumers.py (WebSocket), realtime.py
├── emails/               templates, BaseEmailService, EmailLog, signals
├── common/
│   ├── authentication.py cookie JWT auth with origin check, service-key auth
│   ├── permissions.py    has_admin_access, has_global_access, can_manage_user, classes
│   ├── access.py         application access and visibility
│   ├── pagination.py     StandardPagination, page_size(), paginate()
│   ├── params.py         query and body parameter parsing (400 on bad input)
│   ├── exceptions.py     error envelope and extra exception types
│   ├── routers.py        ApiRouter (no trailing slash)
│   ├── viewsets.py       GenericViewSet and the mixins resources use (PATCH-only update)
│   ├── models.py         TimeStampedModel, CreatedAtModel
│   ├── serializers.py    UserSummarySerializer, OptionalUUIDField, OptionalDateField
│   ├── storage.py        S3 helpers and upload verification
│   ├── uploads.py        checked_upload() for views
│   ├── cache.py          ResilientRedisCache
│   ├── network.py        client_ip()
│   ├── csv_export.py     streaming, formula-safe CSV
│   ├── converters.py     isodate path converter
│   └── middleware.py     last activity, admin IP allowlist, CSP
└── <app>/tests/          test_*.py

portal/
├── app/                  page.tsx (sign-in), forgot-password/, reset-password/, (portal)/ (signed-in area)
├── components/           shared UI and modals
├── lib/
│   ├── api-client.ts     axios instance, cookie credentials, refresh on 401
│   ├── api-errors.ts     extractApiErrorMessage()
│   ├── auth.ts           API base URL, sign-in path helpers
│   ├── file-utils.ts     image compression, 5 MB limit
│   └── api/              one module per API area; types.ts (Paginated, UserSummary)
├── public/sw.js          service worker (browser push)
└── e2e/                  Playwright suite (see portal/e2e/README.md)
```

## 3. Backend architecture

### 3.1 Request pipeline

Middleware, in order: CORS, Security, `AdminIPAllowlistMiddleware`
(`/admin/` only), WhiteNoise, sessions, common, CSRF (Django admin only),
auth, `LastActivityMiddleware` (updates `last_activity_at` at most once a
minute), `CSPMiddleware`, messages, clickjacking.

DRF defaults (`REST_FRAMEWORK` in settings):

| Setting | Value |
|---|---|
| Authentication | `common.authentication.CookieJWTAuthentication` |
| Permission | `IsAuthenticated` |
| Parsers | JSON only (form and multipart bodies get 415) |
| Pagination | `common.pagination.StandardPagination` |
| Exception handler | `common.exceptions.custom_exception_handler` |
| Throttles | anon 200/min, user 1000/min; scoped: login 25/min, refresh 200/min, admin 150/min, email 25/h, support 100/min, uploads 100/min, service 120/min |
| `NUM_PROXIES` | `TRUSTED_PROXY_COUNT` |

### 3.2 Client address

`common.network.client_ip()` reads `X-Forwarded-For` from the right, skipping
`TRUSTED_PROXY_COUNT` entries' worth of proxies; entries further left are
caller-supplied and ignored. Used by the admin allowlist, the audit log and
sign-in lockouts; throttles use the same count. Production: Cloudflare then
CapRover nginx, so `TRUSTED_PROXY_COUNT=2`.

### 3.3 Cache

`CACHE_URL` set: `common.cache.ResilientRedisCache` (Django's Redis cache that
treats an unreachable Redis as an empty cache, logs at most once a minute,
1-second socket timeouts). Unset: per-process memory (fine for development,
not for production with several processes). The cache holds sign-in failure
counters and lockouts, rate-limit windows, reset-email counts, summary
re-share limits and the end-of-day job lock. While Redis is down these are
not enforced; `/health/` reports `{"status": "degraded", "cache": "unreachable"}`.

### 3.4 Audit log

`audit.log_audit(action=AuditAction.X, request=..., target_type=..., target_id=..., metadata=...)`.
Every action name is a constant in `audit/actions.py`
(`UPPER_SNAKE`, for example `ADMIN_USER_CREATED`, `INVENTORY_ITEM_ASSIGNED`,
`ORG_MEMBERS_ADDED`). Readable text comes from `audit/messages.py`. The old
`applications.audit*` modules forward to these for one release; import from
`audit` in new code. Share
tokens and passwords are never logged. Failed sign-in and failed reset rows
are deleted after `AUDIT_AUTH_FAILURE_RETENTION_DAYS` (90).

### 3.5 Code conventions

- **Views.** A resource is a `GenericViewSet` (from `common.viewsets`) with
  only the mixins it needs, or actions written out. Changes are PATCH
  (`PartialUpdateModelMixin`); no resource accepts PUT (the only PUTs set a
  single value you own, see section 6), and there is no
  `ModelViewSet` or `http_method_names`. Permissions and rate limits that
  differ per action go in `get_permissions()` and `get_throttles()`, keyed on
  `self.action`. Viewsets go on `ApiRouter`, or, where route names or typed
  ids must stay as they are, on explicit paths with `as_view({...})`
  (notifications, applications, audit logs, reports, summaries). Sign-in,
  password, `/me` and `/external/users` stay as `APIView`s: they are not
  resources.
- **Route table.** `common/tests/route_methods.json` lists every route with
  its name and allowed methods; `test_route_methods` fails if one is added,
  removed, renamed or gains or loses a method. After a deliberate change:
  `UPDATE_ROUTE_TABLE=1 python manage.py test common.tests.test_route_methods`,
  and review the diff.
- **Input.** Request bodies are read through serializers, never
  `request.data.get(...)`. `OptionalUUIDField` and `OptionalDateField` treat
  a blank value as absent and give the same messages as `common.params`.
- **Users.** Model fields use `settings.AUTH_USER_MODEL`; other code uses
  `User = get_user_model()` at the top of the module. Never import `User`
  from `django.contrib.auth.models`.
- **Timestamps.** Models inherit `TimeStampedModel` (rows that change:
  `created_at`, `updated_at`) or `CreatedAtModel` (rows written once:
  history, logs, attachments, shares).
- **Choices.** `models.TextChoices` classes. The tuple names used before
  (`STATUS_CHOICES` and so on) remain as aliases of `.choices`. Stored values
  are lowercase, except the applications app and support categories, which
  have always been uppercase.

### 3.6 Data model notes

- Every model has a UUID primary key except Django's `User` (integer).
- Email is unique, case-insensitive (`auth_user_email_lower_uniq`); empty
  emails are allowed more than once.
- Tasks, recurring schedules, daily reports and support requests protect the
  users they reference (`on_delete=PROTECT`); users are deactivated, never
  deleted. Django admin has no delete for users.
- `Department` has responsibility flags: `manages_inventory`,
  `handles_it_support`, `handles_general_support`.
- Summary share tokens are stored as SHA-256 hashes.
- `ServiceApiKey` stores a SHA-256 of the key and a list of `scopes`.

## 4. Authentication and sessions

### 4.1 Sign-in

`POST /auth/login {email, password}`:

1. Locked? `LoginGuard` keys failures on email + client address. Ten
   failures (`LOGIN_MAX_ATTEMPTS`) lock that pair for 15 minutes
   (`LOGIN_LOCKOUT_SECONDS`); 50 failures an hour across all addresses
   (`LOGIN_ACCOUNT_MAX_ATTEMPTS_PER_HOUR`) lock the account. Locked returns
   403 `account_locked` with `Retry-After` and `error.metadata.retry_after`
   (seconds left, which the portal counts down live; `lib/lockout.ts`). The
   try that uses up the last attempt already returns the lockout.
   Signed-in password checks share the same counters
   (`check_signed_in_password`): the chat password step
   (`/chat/account/check-password`, audited as `AUTH_PASSWORD_CHECK_FAILED`)
   and changing the password (`AUTH_PASSWORD_CHANGE_FAILED`). Their wrong
   answers say how many tries are left, and a lock from any of the three
   applies to all of them.
2. Unknown email: a password hash is computed anyway (equal timing), 401
   "Invalid credentials." with `error.metadata.attempts_remaining`. Audit rows
   for unknown emails are limited to one per email and address every 10
   minutes.
3. Wrong password: 401 with `attempts_remaining`.
4. Right password, disabled account: 403 "This account has been disabled…".
   The disabled state is only revealed to someone with the password.
5. Success: tokens are set as cookies; the body is `{"user": {...}}`.

### 4.2 Tokens and cookies

| Cookie | Lifetime | Flags |
|---|---|---|
| `access_token` | 5 minutes | HttpOnly, SameSite=Lax, Secure outside debug |
| `refresh_token` | 12 hours | same |

Tokens are never returned in a response body. Refresh tokens rotate and the
old one is blacklisted. `POST /auth/refresh` also enforces one hour of
inactivity (`last_activity_at`), refuses inactive users, and returns
`{"detail": "Session refreshed."}`. `POST /auth/heartbeat` records activity.

`CookieJWTAuthentication` accepts `Authorization: Bearer` first, then the
cookie. For a cookie-authenticated request that changes something
(not GET/HEAD/OPTIONS), the `Origin` (or `Referer`) must be in
`CORS_ALLOWED_ORIGINS`, otherwise 403 "This request did not come from the
portal." Together with JSON-only bodies this replaces CSRF tokens.

### 4.3 Ending sessions

`accounts.services.revoke_user_sessions(user)` blacklists every outstanding
refresh token. Called on password change (then a new pair is issued for the
current browser), password reset, and deactivation. `POST /auth/logout` needs
no valid access token: it blacklists the refresh token from the body or
cookie, clears cookies and always returns 204. Expired token records are
deleted daily (`accounts.flush_expired_tokens`).

### 4.4 Passwords and links

- New users: created with an unusable password and emailed a set-password
  link (`AccountSetupTokenGenerator`, `ACCOUNT_SETUP_LINK_TIMEOUT`, 72 hours).
- Administrator reset: `PATCH /users/{id} {"send_reset_link": true}` emails a
  link with the same 72-hour lifetime. Administrators cannot set passwords.
- Forgot password: `POST /auth/password-reset {email}` always returns
  "If an account exists for this email, a password reset link has been
  sent." and sends at most `PASSWORD_RESET_EMAILS_PER_HOUR` (3) per account
  per hour. Link lifetime `PASSWORD_RESET_TIMEOUT` (1 hour).
- `GET /auth/password-reset/validate?uid=&token=` and
  `POST /auth/password-reset/confirm {uid, token, new_password}` accept either
  link type. Links are single-use (they stop working once the password
  changes). Django's password validators apply.
- Links use `PORTAL_BASE_URL/reset-password?uid=…&token=…`.

### 4.5 Service API keys

For other systems. `Authorization: Bearer <key>` on `GET /external/users`
only. Keys are created in Django admin or with
`manage.py create_service_api_key`, stored hashed, shown once. A key needs the
endpoint's scope (`users:read`). Custom keys must be at least 32 characters.
`last_used_at` is written at most once a minute. Throttle: 120 requests a
minute.

## 5. Access control

### 5.1 Roles and capabilities

| Capability | How it is decided (`common/permissions.py` and others) |
|---|---|
| Administrator | `has_admin_access`: superuser, or a profile role with code `ADMIN` (production uses superusers) |
| Global access (executive) | `has_global_access`: superuser, or an active role with `has_global_access=True` (ED, MD) |
| Manager | leads a department (`line_manager`), unit (`supervisor`) or team (`team_lead`); `tasks/hierarchy.py` |
| Asset management | member of a department with `manages_inventory=True` (`inventory.permissions.can_manage_inventory`) |
| Credit clients | `clients.permissions`: **manage** = superuser, a member of a unit with `credit_client_access=manage` (Tourism Accounts), or the supervisor of a unit with `supervisor_manages` (Tourism / Operations); **view** = anyone who manages, global access, members of a unit with any `credit_client_access` (Operations, Tourism Internal Control), or the line manager of a department with `manager_views_credit_clients` (Tourism). Set in Django admin on the unit or department; migration `organization/0006` set them by the production codes |
| Service requests | `service_requests.access`: `Audience` rows per service (Django admin) name who **submits**, **views**, is **notified**, gives the **first approval** and the **final approval**: members of a unit, a unit's supervisor, a department's line manager, or a role. Everyone in any of them, and global access, sees every request. Migration `service_requests/0002` set the agreed ticket audiences by the production codes |
| Managing another user | `can_manage_user`: administrators may manage ordinary staff; superusers and executives can only be managed by a superuser |

A deactivated role confers nothing.

### 5.2 Role-gated endpoints

Verified by `api/common/tests/test_rbac_matrix.py` (signed-out requests get
401 everywhere; a service key reaches only `/external/users`).

| What | Staff | Line manager | Asset dept (IT) | Executive | Administrator |
|---|---|---|---|---|---|
| Staff directory, organization tree, list departments/units/teams | yes | yes | yes | yes | yes |
| One user's full record (`GET /users/{id}`), list roles | - | - | - | yes | superuser only |
| Create users, edit users, enable/disable, send reset link | - | - | - | - | yes |
| Create, edit, delete departments/units/teams; move members | - | - | - | - | yes |
| List and open applications (subject to access rules) | yes | yes | yes | yes | yes |
| Create and edit applications, logos, per-person exceptions | - | - | - | - | yes |
| Audit log | - | - | - | yes | yes |
| Organization weekly summary | - | - | - | yes | superuser only |
| Department support queue | - | own departments | if they lead it | - | - |
| View and export assets and maintenance logs | - | - | yes | yes | yes |
| Create, edit, assign, return assets; maintenance logs; categories | - | - | yes | - | yes |
| My assets | yes | yes | yes | yes | yes |

Further rules:
- Nobody changes their own role or disables their own account; the last
  active superuser cannot be disabled.
- Executives can read everything administrative but change nothing.

### 5.3 Record-level visibility

| Records | Who sees them |
|---|---|
| Tasks | Assigner and assignee; managers of either (read, comment, attach); executives (read, comment). Status changes are for the assigner and assignee only. |
| Recurring schedules | Creator (full control); assignee and managers (read). |
| Daily reports | Members of the same department (the All Reports list); a single report page: its author and executives. Entries and comments: the author (current day only) and executives. |
| Weekly summaries | The owner; a colleague it was shared with (personal link); any signed-in user with a valid public link. |
| Support requests | Requester; assigned handler; line manager of the department handling it; the requester's line manager at the time (read only). |
| To-dos, goals, notifications, push subscriptions | The owner only. |
| Applications | Everyone sees applications with `visibility_scope=VISIBLE_TO_ALL`; hidden ones (including deleted) only administrators. `app_url` is null for anyone who cannot open the app. |

Application access (`common/access.py`): global access → yes; an unexpired
per-person exception (allow or deny) wins next; `ALL_AUTHENTICATED` → yes;
otherwise the user's department must be one of the application's
departments. An inactive application cannot be opened.

## 6. API conventions

- Base path `/api/v1`. **No trailing slash** on any route
  (`APPEND_SLASH = False`; a trailing slash is a 404).
- **JSON only** in request bodies.
- **Methods**: `GET` read, `POST` create or action, `PATCH` partial update,
  `DELETE` remove. `PUT` only sets a single value that belongs to the caller,
  replacing it whole: `PUT /me/profile-photo` and
  `PUT /chat/messages/{id}/reaction`. A resource with several fields is
  changed with `PATCH`, never `PUT`.
- **Parameters**: free text is `search`; filters on related records are
  `<name>_id`; several values are comma-separated
  (`?status=pending,in_progress`); leave a filter out for "all" (no `all`
  sentinel). A malformed ID, date, number or choice is a 400 naming the
  parameter.
- **References in bodies** are `<name>_id` (`assigned_to_id`,
  `department_id`, `category_id`, `team_lead_id`, …). In responses, related
  users are nested objects in one shape (`UserSummarySerializer`):
  `{id, username, email, first_name, last_name, full_name, is_active}`.
- **Lists** are paginated:

```json
{"count": 57, "page": 2, "page_size": 20, "total_pages": 3, "results": [ ... ]}
```

  `page` and `page_size` (up to 100) are query parameters. Default sizes:
  20; applications 15; audit logs 30; to-dos 25; support 10;
  notifications 20 (max 50); `reports/all` one day per page (`count` is the
  number of days, plus `current_date` and `total_reports`).
  Not paginated on purpose: organization departments, units and teams,
  inventory categories, `/me/inventory`, task drafts, `/summaries/weeks`,
  `/external/users`.

- **Errors** always use one shape:

```json
{"error": {"type": "validation_error", "message": "Validation failed.", "details": {"field": ["message"]}}}
```

  `type` is one of `validation_error` (400), `authentication_error` (401),
  `authorization_error` (403), `account_locked` (403), `not_found` (404),
  `conflict` (409), `gone` (410), `rate_limited` (429),
  `bad_gateway` (502), `service_unavailable` (503). Extra data is in
  `error.metadata` (for example `attempts_remaining`).

- **Action results**: an action on one record returns that record; bulk
  actions return `{"count": n}`; deletes and revokes return 204;
  message-only actions return `{"detail": "..."}`.
- **Status codes worth knowing**: 409 for a conflict with current state
  (deleting a group that has members, an asset with history, a task changed
  by someone else meanwhile, a duplicate goal); 410 for an expired share link;
  403 when the user may not make a change, 400 when the change itself is
  invalid; an upsert returns 201 when it created and 200 when it updated.

## 7. API reference

All paths are under `/api/v1`. Generated from the URL configuration on
2026-11-17.

### Authentication and current user

| Methods | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{email, password}` → `{user}`; cookies set |
| POST | `/auth/logout` | always 204 |
| POST | `/auth/refresh` | cookie or `{refresh}` |
| POST | `/auth/heartbeat` | records activity, 204 |
| POST | `/auth/change-password` | `{old_password, new_password}` |
| POST | `/auth/password-reset` | `{email}` |
| GET | `/auth/password-reset/validate` | `?uid=&token=` → `{valid, email}` (masked) |
| POST | `/auth/password-reset/confirm` | `{uid, token, new_password}` |
| GET | `/me` | current user, including `has_global_access`, `is_manager`, `manager_scope`, `can_manage_inventory` |
| GET | `/me/permissions` | `{is_superuser, has_global_access, role_code, department_id}` |
| GET | `/me/recent-applications` | last four opened |
| GET | `/me/inventory` | assets assigned to me |
| POST | `/me/profile-photo/upload-url` | where to upload a new profile photo |
| PUT, DELETE | `/me/profile-photo` | set or replace your profile photo / remove it |

### Users

| Methods | Path | Notes |
|---|---|---|
| GET, POST | `/users` | list: `search`, `department_id`, `unit_id`, `team_id`, `unassigned=department\|unit\|team`, `include_inactive=true` (administrators and executives). Create: `{first_name, last_name, email, role_id?, department_id?, unit_id?, team_id?}`; emails a set-password link |
| GET, PATCH | `/users/{user_id}` | PATCH any of `first_name, last_name, email, role_id, department_id, unit_id, team_id, is_active, send_reset_link` |
| GET | `/external/users` | service key only; `?is_active=true\|false\|all`; plain array |

### Organization

| Methods | Path | Notes |
|---|---|---|
| GET | `/organization/hierarchy` | departments → units → teams with leaders and `members_count` |
| GET | `/organization/roles` | |
| GET, POST | `/organization/departments` | `search`; inactive ones only for administrators |
| GET, PATCH, DELETE | `/organization/departments/{pk}` | `line_manager_id` must be a member; DELETE with members → 409 |
| POST | `/organization/departments/{pk}/members` | `{action: "add", user_ids}` |
| GET, POST | `/organization/units` | `department_id` filter |
| GET, PATCH, DELETE | `/organization/units/{pk}` | `supervisor_id` |
| POST | `/organization/units/{pk}/members` | `{action: "add"\|"remove", user_ids}` |
| GET, POST | `/organization/teams` | `unit_id` filter |
| GET, PATCH, DELETE | `/organization/teams/{pk}` | `team_lead_id` |
| POST | `/organization/teams/{pk}/members` | `{action, user_ids}` |

### Applications and audit log

| Methods | Path | Notes |
|---|---|---|
| GET, POST | `/applications` | `search`, `department_id` (comma list, executives and administrators), `accessible=true` |
| GET, PATCH, DELETE | `/applications/{application_id}` | DELETE hides and deactivates |
| GET | `/applications/{application_id}/can-access` | |
| POST | `/applications/{application_id}/open` | records the visit, returns `{url}` |
| POST | `/applications/logo-upload-url` | `{slug, file_name, content_type}` |
| GET, POST | `/applications/{application_id}/overrides` | `{user_id, effect: ALLOW\|DENY, reason?, expires_at?}` |
| DELETE | `/applications/{application_id}/overrides/{override_id}` | |
| GET | `/audit-logs` | `action`, `target_type`, `actor_user_id`, `created_from`, `created_to` |
| GET | `/audit-logs/{log_id}` | |

### Tasks, recurring schedules, drafts

| Methods | Path | Notes |
|---|---|---|
| GET, POST | `/tasks` | list: `view=assigned\|created\|team`, `status`, `priority` (comma lists). Create: `{title, description?, priority, deadline, assigned_to_id}` or `assigned_to_ids` (up to 50) → `{count, results}` |
| GET | `/tasks/dashboard` | counts and recent tasks |
| GET, PATCH | `/tasks/{pk}` | assignee cannot be changed |
| GET | `/tasks/{pk}/activities` | timeline |
| POST | `/tasks/{pk}/approve` | assigner, task under review |
| POST | `/tasks/{pk}/reject` | assigner; `{reason?, target_status?: in_progress\|pending}` |
| POST | `/tasks/{pk}/comments` | `{comment, attachments?, links?}` |
| POST | `/tasks/{pk}/attachment-upload-url` | `{file_name, content_type, size}` |
| GET, POST | `/recurring-schedules` | create returns `{count, results}` |
| GET, PATCH | `/recurring-schedules/{pk}` | creator only for PATCH |
| POST | `/recurring-schedules/{pk}/pause`, `/resume`, `/end` | creator only |
| GET, POST | `/task-drafts` | up to 50 per user |
| GET, PATCH, DELETE | `/task-drafts/{pk}` | |

### To-dos and goals

| Methods | Path | Notes |
|---|---|---|
| GET, POST | `/todos` | `view`, `priority`, `search` |
| GET, PATCH, DELETE | `/todos/{pk}` | |
| POST | `/todos/{pk}/toggle-complete` | |
| POST | `/todos/{pk}/snooze` | `{minutes}` (1 or more; capped at a year) |
| GET | `/todos/stats` | |
| POST | `/todos/clear-completed` | `{count}` |
| GET, POST | `/goals` | `week_start_date` |

### Daily reports

| Methods | Path | Notes |
|---|---|---|
| GET | `/reports/month` | calendar |
| GET, POST | `/reports/day` | the day's report; POST adds an entry (`report_date`, title, comment), creating the day's report on first use; current day only |
| GET | `/reports/all` | department reports, one day per page; `department_id` (executives), `date`, `date_from`, `date_to`, `search` |
| GET | `/reports/daily/{report_id}` | |
| POST | `/reports/daily/{report_id}/send-email` | `{recipients}` (registered active users) |
| POST | `/reports/daily/{report_id}/subreports` | today only |
| GET | `/reports/subreports/{subreport_id}` | |
| POST | `/reports/subreports/{subreport_id}/comments` | today only |

### Weekly summaries

`{week}` is the Monday the week starts on, `YYYY-MM-DD` (anything else is 404).

| Methods | Path | Notes |
|---|---|---|
| GET | `/summaries/weeks` | weeks with a summary |
| GET | `/summaries/weeks/{week}` | |
| GET | `/summaries/weeks/{week}/comparison` | |
| GET | `/summaries/weeks/{week}/history` | `weeks` (1–52, default 4) |
| GET, POST, DELETE | `/summaries/weeks/{week}/share` | status / create (returns `share_link` once, replaces any previous link, expires in 30 days) / revoke |
| GET, POST | `/summaries/weeks/{week}/user-shares` | `{user_id}`; recipient emailed and notified |
| DELETE | `/summaries/weeks/{week}/user-shares/{user_id}` | |
| POST | `/summaries/weeks/{week}/export` | PDF to S3 |
| GET | `/summaries/organization` | `week_start_date`; executives |
| GET | `/summaries/shared/{token}` | expired → 410 |
| GET | `/summaries/{summary_pk}/files` | `view=sent\|received`, `token` |

### Support

| Methods | Path | Notes |
|---|---|---|
| GET, POST | `/support/requests` | `status`; create `{title, category: IT_SUPPORT\|OTHER, priority, description}` |
| GET | `/support/requests/department` | queue of departments the caller leads |
| GET | `/support/requests/{pk}` | |
| POST | `/support/requests/{pk}/assign` | `{assigned_to_id}`; department line manager |
| POST | `/support/requests/{pk}/status` | `{status: open\|assigned\|in_progress\|resolved}` |
| POST | `/support/requests/{pk}/resolve` | handler or manager |
| POST | `/support/requests/{pk}/confirm` | requester; closes |
| POST | `/support/requests/{pk}/reopen` | requester |
| POST | `/support/requests/{pk}/comments` | `{body}` |
| POST | `/support/requests/{pk}/attachment-upload-url` | `{file_name, content_type, size}` → `{upload_url, object_key}` |
| POST | `/support/requests/{pk}/attachments` | `{object_key, file_name, content_type, size, comment_id?}` |

### Inventory

| Methods | Path | Notes |
|---|---|---|
| GET, POST | `/inventory/categories` | |
| GET, PATCH, DELETE | `/inventory/categories/{pk}` | |
| GET, POST | `/inventory/items` | `search`, `status`, `category_id`, `managing_department_id` |
| GET, PATCH, DELETE | `/inventory/items/{pk}` | DELETE with history → 409 |
| GET | `/inventory/items/stats` | |
| GET | `/inventory/items/export` | CSV |
| POST | `/inventory/items/photo-upload-url` | PNG, JPEG, WebP |
| POST | `/inventory/items/{pk}/assign` | `{assigned_to_id}` or `{assigned_to_department_id}`, `condition_notes?` |
| POST | `/inventory/items/{pk}/return` | `{condition_notes?}` |
| GET, POST | `/inventory/maintenance-logs` | `item_id`, `status`, `category_id`, `search` |
| GET, PATCH, DELETE | `/inventory/maintenance-logs/{pk}` | completed logs are read-only |
| POST | `/inventory/maintenance-logs/attachment-upload-url` | |
| GET | `/inventory/maintenance-logs/export` | CSV |

### Credit clients

| Methods | Path | Notes |
|---|---|---|
| GET, POST | `/clients` | `search` (name, TIN, contact, email), `status`, `currency`; POST managers only |
| GET, PATCH | `/clients/{pk}` | no DELETE: set `status` to `inactive` |
| GET | `/clients/{pk}/history` | every change: who, when, created/edited/imported, `{field: [old, new]}` |
| GET | `/clients/imports` | confirmed imports with counts |
| GET | `/clients/imports/template` | .xlsx with the expected headers (managers) |
| POST | `/clients/imports/preview` | multipart `file`; checks only, saves nothing (managers) |
| POST | `/clients/imports/confirm` | multipart `file`, `confirmed=true`, `decisions` JSON `{group id: "reject" or row number}`; 409 when errors or decisions are missing |

### Service requests

| Methods | Path | Notes |
|---|---|---|
| GET | `/service-requests` | `search` (reference, client, title, PNR), `status`, `payment_type`, `mine`, `awaiting_me` |
| POST | `/service-requests/tickets` | the ticket form; 400 lists every field problem at once; `confirm_zero_revenue` when revenue is 0 |
| GET | `/service-requests/{pk}` | includes `allowed` (approve, reject, complete, cancel, copy) for the signed-in user |
| POST | `/service-requests/{pk}/approve` | first-stage approver or ED, never the submitter |
| POST | `/service-requests/{pk}/reject` | `{reason}` |
| POST | `/service-requests/{pk}/complete` | submitter only, from submitted or approved |
| POST | `/service-requests/{pk}/cancel` | submitter only, `{reason}`, any open status |
| GET | `/service-requests/{pk}/history` | paginated events |
| GET | `/service-requests/{pk}/evidence` | `{url}`: short-lived link to the payment evidence |
| GET | `/service-requests/awaiting-count` | requests waiting for the user's approval |
| POST | `/service-requests/evidence-upload-url` | submitters; `{file_name, content_type, size}`; images and PDF, 5 MB |
| GET | `/service-requests/suggestions` | `field=airline` or `vendor`, `search`; earlier values, most used first |

### Notifications

| Methods | Path | Notes |
|---|---|---|
| GET | `/notifications` | paginated |
| GET | `/notifications/unread-count` | |
| POST | `/notifications/{notification_id}/read` | |
| DELETE | `/notifications/{notification_id}` | |
| POST | `/notifications/read-all` | `{count}` |
| DELETE | `/notifications/clear-all` | `{count}` |
| GET | `/notifications/push-public-key` | |
| GET, POST | `/notifications/subscriptions` | POST upsert: 201 new, 200 existing |
| DELETE | `/notifications/subscriptions/{subscription_id}` | |

### Chat

End-to-end encrypted; every encrypted value is base64 text the server cannot
open. Full design: `docs/CHAT_SPEC.md`.

| Methods | Path | Notes |
|---|---|---|
| GET, POST, PATCH | `/chat/account` | own key: status; first setup (409 if set up); replace the PIN and/or recovery copy |
| POST | `/chat/account/check-password` | 204 if it is the user's portal password, else 400 with tries left; shares the sign-in lockout (403 `account_locked`) |
| POST | `/chat/account/reset/code` | email an 8-character reset code (15 minutes, one per minute, five tries) |
| POST | `/chat/account/reset/code/check` | check the reset code before the new PIN is chosen |
| POST | `/chat/account/reset` | start over with a new key pair (needs the emailed `code`); adds a "reset" system message to each conversation |
| POST | `/chat/session-secrets` | `{id, secret}` that seals this browser's copy of the unlocked key (12 h) |
| GET, DELETE | `/chat/session-secrets/{id}` | 404 when gone (unlock again) |
| POST | `/chat/ws-ticket` | single-use WebSocket ticket, 30 s |
| GET | `/chat/people?search=` | active users with `chat_ready`, public key, online |
| POST | `/chat/people/{user_id}/invite` | invite someone without chat: opens the waiting conversation (returned) with an "invitation sent" note, notifies and emails them; again = a reminder, once per pair per 24 h |
| GET | `/chat/unread-count` | sidebar badge |
| POST | `/chat/link-preview` | title, description and thumbnail for a link being written (public addresses only; nothing stored) |
| POST | `/chat/groups` | create a group (browser-made id, encrypted details, keys for members with chat; others pending) |
| PATCH | `/chat/conversations/{id}/info` | admins change the encrypted group name, description or photo |
| GET, POST | `/chat/conversations/{id}/photo` | group photo download link / upload link |
| POST | `/chat/conversations/{id}/members` | admins add people with a new key version |
| PATCH, DELETE | `/chat/conversations/{id}/members/{user_id}` | make admin (admins) or not (owner); remove members (admins) or admins (owner); the owner cannot be removed; leave (yourself) |
| POST | `/chat/conversations/{id}/owner` | the owner hands the group over |
| GET, POST | `/chat/conversations` | list one page (`limit`, default 30; `before` cursor; returns `has_more`, `next`, `unread_total`); start a direct chat with wrapped keys (200 if it exists) |
| GET, PATCH | `/chat/conversations/{id}` | one conversation; `muted_until`, `archived` |
| GET, POST | `/chat/conversations/{id}/keys` | own wrapped keys; add the next key version (409 if not next) |
| GET, POST | `/chat/conversations/{id}/messages` | `before_seq`, `after_seq`, `limit` (≤100); send (idempotent on the client's message id) |
| POST | `/chat/conversations/{id}/read` | `{seq}`, only moves forward |
| POST | `/chat/conversations/{id}/attachments` | reserve an encrypted upload, returns presigned PUT URLs |
| PATCH, DELETE | `/chat/messages/{id}` | edit (sender, 30 min, `revision` = current + 1); `?scope=everyone` (sender, 30 min) or `?scope=me` |
| POST | `/chat/conversations/{id}/attachments/forward` | copy an encrypted file from another of your chats into this one, for forwarding |
| PUT, DELETE | `/chat/messages/{id}/reaction` | set or replace your reaction (encrypted emoji, newest key version) / remove it |
| GET | `/chat/attachments/{id}/download?part=file\|thumb` | presigned GET for the encrypted bytes |

Errors with their own type: `key_outdated` (409: refresh keys, make a new
version, resend) and `chat_not_set_up` (403). Non-participants get 404.

WebSocket (realtime app): `wss://<realtime host>/ws/chat/?ticket=…`. Origin
must be in `CORS_ALLOWED_ORIGINS`; close codes 4001 (ticket or account) and
4003 (origin). Events are listed in `docs/CHAT_SPEC.md` 4.3.

Outside `/api/v1`: `GET /health/` (200 `ok`, 200 `degraded` when the cache is
unreachable, 503 when the database is) and `/admin/` (Django admin, IP
allowlist).

## 8. Domain rules

### 8.1 Users and organization

- `PATCH /users/{id}` is a true partial update. Team must sit in the unit,
  unit in the department (`StaffProfile.clean`).
- Someone who leaves a team, unit or department stops leading it
  (`organization.services`). Removing members only affects actual members.
- A leader must be a member of the group they lead.
- Organization changes are audited (`ORG_GROUP_*`, `ORG_MEMBERS_*`,
  `ORG_LEADER_CHANGED`).

### 8.2 Tasks

- Status flow: `pending → in_progress → under_review → completed`. The
  assignee moves work forward (cannot go back to pending once started, cannot
  complete). The assigner edits details and approves (`completed`) or rejects
  (back to `in_progress` or `pending`) work under review. Completed tasks are
  locked.
- Who may make a change is checked first (403,
  `tasks.permissions.require_may_change_task`); then whether the transition is
  valid (400, serializer).
- Updates lock the task row; a status changed by someone else meanwhile is a
  409.
- The assignee cannot be changed after creation. A deadline is required and
  cannot be in the past. Tasks cannot be deleted.
- Comments: 1–500 characters, up to 10 attachments (keys must belong to the
  task) and 10 links.
- Only active users can be assigned. Up to 50 assignees per request; one task
  each.

### 8.3 Recurring schedules

- Daily or weekly, interval 1–365, up to 24 run times a day, deadline offset
  up to a year, own time zone per schedule.
- The creator edits, pauses, resumes and ends; the assignee cannot be changed;
  the start cannot change once started; ending is permanent.
- The generator (every minute) skips paused schedules (re-checked under the
  row lock) and, after downtime, creates only the latest missed run
  (`RECURRING_MAX_CATCH_UP_RUNS`).

### 8.4 Daily reports and summaries

- One report per person per day, created on the first entry; entries and
  comments only on the current day (Lagos time).
- Emails: the first entry of the day emails the author's direct manager (team
  lead, then supervisor, then line manager). At 17:05 Lagos time on weekdays,
  `send_eod_daily_reports` emails each of today's reports to its author and to
  that manager. Only reports with at least one entry, by active accounts, are
  sent; no manager means only the author's copy. One template
  (`emails/reports/daily_report_forward.html`) serves the forward, manager and
  author versions through `email_kind`.
- Weekly summaries are generated Mondays at 00:00 for the week just ended,
  compared at 00:15, cached for the organization view at 00:30 and emailed at
  08:00 (active users only). Calculation: `calculate_user_weekly_summary` in
  `tasks/services/summaries.py`.
  - Own work: tasks assigned to the person (self-assigned included). The
    completion rate is tasks completed that week divided by tasks on their
    list that week (`tasks_open_during_week`: created by Sunday and not
    completed before Monday), so it never exceeds 100%.
  - Delegated work (`calculate_delegated_work`, `delegated_*` fields): tasks
    the person assigned to someone else. Reviews come from task history
    (`status_change` from `under_review`, by the person); review time is from
    the latest submission to that decision. "Waiting for review" and
    "overdue" are as at Sunday night, rebuilt from history, so past weeks can
    be recalculated.
  - `lead_section` is `delegated` when delegated volume (tasks open plus
    reviews) exceeds the person's own open tasks; the email and the summary
    page show that section first. `has_own_work` and `has_delegated_work`
    hide empty sections.
  - Comparisons add `delta_delegated_*` only when both weeks have the
    figures; the trend follows the leading section.
  - After changing the calculation, run
    `manage.py recalculate_weekly_summaries --weeks 4` (no emails).
- Public share links: one per summary at a time, 30 days
  (`SUMMARY_SHARE_LINK_DAYS`), only the hash stored. Sharing with a
  colleague: active users only, not yourself; re-sharing within 10 minutes
  sends nothing new.

### 8.5 Support

- Routing: `IT_SUPPORT` to the department with `handles_it_support`, others to
  the one with `handles_general_support`.
- The requester's line manager is recorded on the request at creation.
- Handlers and managers can set `open`, `assigned`, `in_progress`,
  `resolved`; only the requester's confirmation (or the daily job, seven days
  after resolution, `SUPPORT_AUTO_CLOSE_DAYS`) closes a request. Reopening
  clears the assignment.
- Requests cannot be edited or deleted directly.

### 8.6 Inventory

- Status: `available`, `assigned`, `maintenance`, `retired`, `unaccounted`
  (reason required).
- Assign to a person or a department, not both; assigning or returning locks
  the item row. Only active people can receive assets.
- Opening a maintenance log moves the item to maintenance (not allowed for
  retired or unaccounted items); completing the last open log returns it to
  `assigned` (person or department) or `available`. Completed logs are
  read-only. At most five attachments per log.
- An item with assignment or maintenance history cannot be deleted (409).
- Exports stream and are formula-safe.

### 8.6a Credit clients

- The portal shows them under Service Requests (`/service-requests/clients`),
  the one sidebar section for the whole service request feature; requests and
  approvals will be further tabs there.
- Fields: name (unique, ignoring case), TIN (unique; 8 to 15 digits, optional
  `-` and 4 digits; spaces removed), contact person, phone (7 to 15 digits) and
  email (all three required), address, credit limit (> 0, 2 decimals), credit days (whole, 0 to
  3650), credit utilization (>= 0), currency (NGN, USD, AED, GBP, EUR), status
  (active/inactive), notes. The rules live in `clients/validation.py` and are
  shared by the form and the import.
- Available balance is never stored: credit limit minus credit utilization. It
  may be negative (utilization above the limit), which later makes requests
  need approval. Repayments are not recorded yet.
- Import (`clients/importer.py`): .xlsx (first sheet) or UTF-8 .csv, at most
  5 MB, 5000 rows. Headers match ignoring case, extra spaces, underscores and
  hyphens. In order: (1) a missing required column (Name, TIN, Contact
  Person, Phone, Email, Credit Limit, Credit Days) or a repeated column rejects the file; (2) any field error
  rejects it, listed by row and column; (3) only then the review: unrecognised
  columns (not imported), missing Status/Currency/Credit Utilization (new
  clients get Active/NGN/0, updated clients keep theirs), an Available Balance
  column (ignored), clients over their limit, and duplicates. Rows sharing a
  name or TIN with each other or with an existing client form one group; the
  uploader picks one row to import (or update the existing client with), or
  rejects the group. A row matching two different existing clients is an
  error. Confirming re-checks the same file and saves everything or nothing.
- Every create, edit and import is in the client's history and the audit log
  (`CREDIT_CLIENT_CREATED`, `CREDIT_CLIENT_UPDATED`, `CREDIT_CLIENTS_IMPORTED`).

### 8.6b Service requests (tickets)

- Replaces the emailed approval templates. Ticket and affiliate ticket share
  one form (`party_type`); the other services (visa, hotel, other service,
  travel package, refund) and part payment are not built yet.
- A request starts with **cash or credit**. Cash: client name typed, amount
  paid (at least the selling price) and payment evidence (image or PDF, 5 MB)
  required. Credit: an active credit client is chosen; no evidence.
- Pricing (`service_requests/validation.py`): revenue = selling − cost, never
  typed; negative is refused, zero must be confirmed. The optional discount
  section (required for affiliates) sets cost = published fare − commission
  given and balance commission = net commission − commission given
  (`ticket_costs`, the formula Tourism confirmed). Errors when commission given
  > net commission or net commission > published fare.
- Another currency: optional for cash (both amount and rate, or neither);
  required for a credit client billed in another currency, whose balance is
  charged the foreign amount. Amount × rate must cover the selling price.
- PNR: 5 to 8 letters and digits, unique among requests that are not cancelled
  or rejected (`TicketDetails.active_pnr`). Route: `LOS-ABV` style codes.
- Credit: the client row is locked; within the balance the request is
  **Submitted** and the utilization rises at once. Over it, **Pending
  approval**: first stage (any first-stage approver), then the final stage
  (ED); the utilization rises on the final approval. Nobody approves their own
  request. A rejection (with reason) closes it and frees the PNR; the balance
  does not change.
- Only the submitter marks it **Completed** (the ticket is issued) or
  **Cancelled** (reason required, any open status; a credit request's amount
  goes back). No editing after submitting: a cancelled or rejected request can
  be copied into a new one (`created_from`), evidence included.
- References per service and year (`TKT-2026-00042`, `ReferenceCounter`).
  Title: `[TICKET] Client: [CLIENT_PASSENGER +N | Amount: ₦X]`.
- Every event notifies (in-app, push and email) the people agreed: submitted →
  notify audience; needs approval → also first-stage approvers; first approval
  → submitter and final approvers; approved or rejected → all of them;
  completed or cancelled → everyone told before. The actor is never notified.
  Balance changes appear in the client's history (`CreditClientChange` source
  `request`).

### 8.7 Applications

- Deleting hides and deactivates. Logo URLs must point at our bucket.
- Changing an application's departments emails the departments that gained
  access and the people who lost it.

### 8.8 Chat

- Anyone active can message anyone active who has set up chat. One direct
  conversation per pair (`Conversation.direct_key`).
- The server never receives plaintext. Keys: one X25519 pair per user; the
  private key is stored only encrypted: once with a 6-digit chat PIN inside a
  second layer made from the portal password (both Argon2id, derived in the
  browser), and once with a recovery code. The sign-in form derives the
  password layer's secret and keeps it sealed for the session; the portal's
  change-password dialog moves that layer to the new password. After a reset
  by link or admin, the recovery code is needed once. Each conversation has versioned symmetric keys, each
  wrapped for every participant. Messages: XChaCha20-Poly1305 with associated
  data `conversation|message|sender|key version|revision`. Files: libsodium
  secretstream, 64 KiB chunks, the file key inside the message.
- A message must use the newest key version, and that version must have been
  made for every participant's current key; otherwise `key_outdated`.
- Edit and delete for everyone: sender only, 30 minutes from sending. Delete
  for everyone clears the ciphertext and removes the files from storage;
  everyone sees "This message was deleted". Delete for me: any time, per user
  (`HiddenMessage`).
- A deactivated user's conversations stay readable; nobody can send to them.
- Invitations: inviting someone without chat creates the direct conversation
  with no key and an `invite_sent` system message; sending is refused (403)
  until every member has set up chat. Setting up chat adds `invite_accepted`
  to each conversation the user was invited to and tells the members
  (`key.changed`); the first sender then makes key version 1.
- Push for a message goes only to recipients with no open socket and not
  muted, says "New message", and creates no bell entry.
- The audit log records chat setup, backup changes and resets, never message
  activity.

## 9. File uploads

Flow: the browser asks the API for a presigned PUT URL (`*-upload-url`),
uploads directly to S3, then sends the returned `object_key` (or public URL)
back to the API with the record.

Before a file is recorded, `common.storage.verify_upload` asks S3
(`head_object`) for its real size and type, refuses (and deletes) a file that
is missing, too large or of the wrong type, and records what S3 reports.
Keys must sit under the record's own folder. Switched off by
`VERIFY_UPLOADS=False` (tests and the e2e stack).

| Upload | Folder setting | Allowed types | Served by |
|---|---|---|---|
| Task attachments | `TASK_ATTACHMENT_S3_PREFIX/<task id>/` | attachment list | short-lived signed links |
| Support attachments | `SUPPORT_ATTACHMENT_S3_PREFIX/<request id>/` | attachment list | short-lived signed links |
| Maintenance attachments | `AWS_MAINTENANCE_ATTACHMENT_S3_PREFIX/` | attachment list | short-lived signed links |
| Asset photos | `AWS_INVENTORY_PHOTO_S3_PREFIX/` | PNG, JPEG, WebP | public URL |
| Application logos | `AWS_APPLICATION_LOGO_S3_PREFIX/` | PNG, JPEG, WebP | public URL |
| Summary PDFs (server) | `SUMMARY_PDF_EXPORT_S3_PREFIX/` | PDF | signed link |

Attachment list (`TASK_ATTACHMENT_ALLOWED_CONTENT_TYPES`): PNG, JPEG, WebP,
PDF, plain text, ZIP, Word, Excel. API maximum `TASK_ATTACHMENT_MAX_SIZE`
(10 MB); the portal stops files over 5 MB and compresses images before upload.

The AWS key needs `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on
every folder above. Each folder setting must point inside what the key may
write (in development every folder is under `development/`).

## 10. Background jobs, emails and notifications

### 10.1 Beat schedule (Africa/Lagos time)

| Job | When |
|---|---|
| `tasks.generate_recurring_task_occurrences` | every minute |
| `tasks.check_due_todo_reminders` | every minute |
| `tasks.send_eod_daily_reports` | 17:05 Monday–Friday |
| `support.auto_close_resolved_requests` | 01:00 daily |
| `chat.remove_unsent_attachments` | 03:00 daily (files reserved over a day ago and never sent) |
| `accounts.flush_expired_tokens` | 02:00 daily |
| `accounts.prune_auth_failure_audit_logs` | 02:30 daily |
| `tasks.generate_weekly_summaries` | 00:00 Monday |
| `tasks.calculate_weekly_comparisons` | 00:15 Monday |
| `tasks.cache_organization_summaries` | 00:30 Monday |
| `tasks.send_weekly_summary_emails` | 08:00 Monday |

Jobs have a soft time limit of 540 s and a hard limit of 600 s. Results are not
stored (`CELERY_TASK_IGNORE_RESULT`).

### 10.2 Emails

`emails/services/*` build emails from templates in `emails/templates/`.
`BaseEmailService.send_email`:
- inside a database transaction, waits for the commit
  (`EMAIL_SEND_ON_COMMIT`), so rolled-back work sends nothing;
- queues `emails.tasks.send_email_task` (3 retries, a minute apart) when
  `SEND_EMAILS_CELERY` is on, otherwise sends in-process;
- with `EMAIL_DEBUG`, logs instead of sending (account emails, which carry
  password links, are only printed in debug mode);
- records every attempt in `EmailLog` (Django admin → Email logs).

Account emails never contain a password.

Templates are Django templates. Each one extends `emails/_base.html` (layout,
styles, footer) and uses `emails/_button.html` for its button with a plain
link underneath; layout is table-based so Outlook and Gmail render it. Every
template receives `portal_url` (`PORTAL_BASE_URL`), so links are absolute.
`render_email()` in `base_email_service.py` renders the HTML and a plain-text
part (no CSS, links written out).

A tag such as `{% endif %}` must stay on one line. Do not run an HTML
formatter on the templates (`.prettierignore` excludes them).
`emails/tests/test_templates.py` compiles and renders every template and
checks that every email service points at a template that exists.

### 10.3 Notifications and push

`notifications.services.create_notification(...)` stores a `Notification`
and, after commit, sends browser push through `notifications.send_push`
(Celery when `SEND_PUSH_CELERY`, otherwise in-process). Push needs the VAPID
settings. Subscription endpoints must be https on a known push service
(`WEB_PUSH_ALLOWED_HOSTS`); others are refused, and stored ones that fail the
check are switched off. Gone subscriptions (404/410) are deactivated. Timeout
`WEB_PUSH_TIMEOUT_SECONDS` (10).

Types: `task_assigned`, `task_status_changed`, `task_comment`,
`support_request_submitted`, `support_request_assigned`,
`support_status_updated`, `support_comment_added`, `support_request_resolved`,
`support_request_closed`, `todo_reminder`, `inventory_assigned`,
`summary_shared`, `chat_nudge` (chat invitation; also emailed with
`emails/chat/chat_invitation.html`).

Chat messages are pushed with `notifications.services.push_to_user` (no
`Notification` row); the payload has a per-conversation `tag`, so a new one
replaces the last on the device.

## 11. Configuration reference

All read in `api/portalapi/settings.py` from the environment or `api/.env`.
Every variable, grouped by area with its default, is listed in
`api/.env.example` (API) and `portal/.env.example` (web app); copy them to
`api/.env` and `portal/.env` to start.

### Core

| Variable | Default | Notes |
|---|---|---|
| `DJANGO_SECRET_KEY` | placeholder | required outside debug |
| `DJANGO_DEBUG` | `False` | |
| `DJANGO_ALLOWED_HOSTS` | `127.0.0.1,localhost` | |
| `CORS_ALLOWED_ORIGINS` | local origins | must contain the web app's origin (also used for the cookie origin check) |
| `CSRF_TRUSTED_ORIGINS` | production origins | Django admin |
| `ADMIN_ALLOWED_IPS` | `127.0.0.1` | client addresses allowed into `/admin/` outside debug |
| `TRUSTED_PROXY_COUNT` | `1` | production `2` |
| `PORTAL_BASE_URL` | local or production | emailed links |
| `APP_TIME_ZONE` | `Africa/Lagos` | |
| `LOG_LEVEL` | `INFO` | project loggers |

### Database, Redis, Celery

| Variable | Default | Notes |
|---|---|---|
| `DB_NAME`, `DB_USER`, `DB_HOST`, `DB_PORT` | `incel_portal_db`, `incel_portal_user`, `127.0.0.1`, `5432` | |
| `DB_PASSWORD` | placeholder | required outside debug |
| `CACHE_URL` | empty (memory) | Redis URL, a different database number from Celery |
| `CELERY_BROKER_URL` | `redis://127.0.0.1:6379/0` | |
| `CHANNEL_LAYER_URL` | empty (in-process) | Redis URL for chat WebSocket delivery, its own database number; required in production |
| `CELERY_RESULT_BACKEND` | broker URL | |
| `CELERY_TASK_SOFT_TIME_LIMIT`, `CELERY_TASK_TIME_LIMIT` | `540`, `600` | seconds |
| `RECURRING_MAX_CATCH_UP_RUNS` | `1` | |
| `TEST_USE_SQLITE`, `TEST_DB_NAME` | `true`, empty | test runs only |

### Sign-in and accounts

| Variable | Default |
|---|---|
| `LOGIN_MAX_ATTEMPTS` | `10` |
| `LOGIN_LOCKOUT_SECONDS` | `900` |
| `LOGIN_ACCOUNT_MAX_ATTEMPTS_PER_HOUR` | `50` |
| `LOGIN_THROTTLE_RATE` | `25/minute` (per client address; the e2e server raises it) |
| `PASSWORD_RESET_TIMEOUT` | `3600` |
| `ACCOUNT_SETUP_LINK_TIMEOUT` | `259200` (72 h) |
| `PASSWORD_RESET_EMAILS_PER_HOUR` | `3` |
| `AUDIT_AUTH_FAILURE_RETENTION_DAYS` | `90` |

### Email

| Variable | Default |
|---|---|
| `EMAIL_ENABLED` | `True` |
| `EMAIL_DEBUG` | `False` (log instead of send) |
| `SEND_EMAILS_CELERY` | `True` |
| `EMAIL_BACKEND` | SMTP |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS` | `smtp.gmail.com`, `587`, `True` |
| `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` | empty |
| `DEFAULT_FROM_EMAIL`, `EMAIL_SENDER_NAME` | `noreply@localhost`, `Incel Portal` |
| `EMAIL_TIMEOUT` | `15` |
| `EMAIL_FILE_PATH` | `api/sent-mail` (file backend only) |

### Storage

| Variable | Default |
|---|---|
| `AWS_S3_BUCKET_NAME`, `AWS_S3_REGION_NAME` | empty |
| `AWS_S3_CUSTOM_DOMAIN`, `AWS_S3_ENDPOINT_URL` | empty |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | (read by boto3) |
| `AWS_S3_OBJECT_ACL` | `private` |
| `VERIFY_UPLOADS` | `True` |
| `TASK_ATTACHMENT_S3_PREFIX` | `task-attachments` |
| `SUPPORT_ATTACHMENT_S3_PREFIX` | `support-attachments` |
| `AWS_MAINTENANCE_ATTACHMENT_S3_PREFIX` | `maintenance-attachments` |
| `AWS_INVENTORY_PHOTO_S3_PREFIX` | `inventory/photos` |
| `AWS_APPLICATION_LOGO_S3_PREFIX` | `application-logos` |
| `AWS_PROFILE_PHOTO_S3_PREFIX` | `profile-photos` |
| `SUMMARY_PDF_EXPORT_S3_PREFIX` | `pdf-exports` |
| `TASK_ATTACHMENT_MAX_SIZE` | 10 MB |
| `TASK_ATTACHMENT_MAX_FILES` | `10` |
| `TASK_ATTACHMENT_ALLOWED_CONTENT_TYPES` | see section 9 |
| `*_UPLOAD_URL_EXPIRES_IN` | `900` |
| `TASK_ATTACHMENT_DOWNLOAD_URL_EXPIRES_IN`, `SUPPORT_ATTACHMENT_DOWNLOAD_URL_EXPIRES_IN` | `60` |
| `MAINTENANCE_ATTACHMENT_DOWNLOAD_URL_EXPIRES_IN` | `300` |

### Other features

| Variable | Default |
|---|---|
| `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT` | empty (push off) |
| `SEND_PUSH_CELERY` | `True` |
| `WEB_PUSH_ALLOWED_HOSTS` | FCM, Mozilla, Apple, Windows push hosts |
| `WEB_PUSH_TIMEOUT_SECONDS` | `10` |
| `SUMMARY_SHARE_LINK_DAYS` | `30` |
| `SUPPORT_AUTO_CLOSE_DAYS` | `7` |
| `CHAT_ATTACHMENT_S3_PREFIX` | `chat-attachments` |
| `CHAT_STORAGE_COPY` | `true` (forwarding copies encrypted files with S3 CopyObject; the AWS key needs read and write on the chat prefix) |
| `CHAT_ATTACHMENT_MAX_SIZE` | 25 MB (original file) |
| `CHAT_UPLOAD_URL_EXPIRES_IN`, `CHAT_DOWNLOAD_URL_EXPIRES_IN` | `900`, `300` seconds |

Web app (build time): `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_CHAT_WS_URL`
(the realtime app's origin, e.g. `wss://workspacews.incelgroup.com`; defaults
to the API origin). `portal/next.config.ts` also reads `AWS_S3_BUCKET_NAME`,
`AWS_S3_REGION_NAME`, `AWS_S3_CUSTOM_DOMAIN` and `AWS_S3_ENDPOINT_URL` when the
server starts, to allow those hosts for `next/image`. The end-to-end variables
(`E2E_*`) are in `portal/e2e/README.md` and `portal/.env.example`.

## 12. Frontend architecture

- **Routes** (`portal/app`): `/` sign-in, `/forgot-password`,
  `/reset-password` (also used to set a first password), and under
  `app/(portal)/`: `/dashboard`, `/tasks`, `/tasks/[id]`,
  `/tasks/recurring/[id]`, `/todos`, `/goals`, `/reports`,
  `/reports/[date]`, `/reports/daily/[reportId]`,
  `/reports/subreports/[subreportId]`, `/reports/all`, `/summaries`,
  `/summaries/[id]/files`, `/organization-summary`, `/applications`,
  `/support`, `/support/[id]`, `/inventory`, `/inventory/[id]`,
  `/inventory/maintenance`, `/my-assets`, `/users`, `/departments`, `/logs`,
  `/chat`, `/chat/[conversationId]`.
- **Layout** (`app/(portal)/layout.tsx`) loads `/me` and `/me/permissions`,
  guards admin-only routes, and builds the sidebar from the same flags.
- **API client** (`lib/api-client.ts`): `withCredentials` (cookies); on a 401
  it calls `/auth/refresh` once (shared across concurrent requests) and
  retries, otherwise sends the user to sign-in with `?next=`. The browser
  never sees a token.
- **API modules** in `lib/api/`; shared types in `lib/api/types.ts`:
  `Paginated<T>`, `hasNextPage()`, `UserSummary`.
- **Errors**: `extractApiErrorMessage(error, fallback)` reads the error
  envelope; an HTML error page or a 5xx without a message becomes "Something
  went wrong on our side. Please try again in a moment."
- **Lists** use a request counter so only the newest response updates the
  list (no stale results when filters change quickly).
- **Uploads** go straight to S3 (`lib/file-utils.ts` compresses images and
  enforces 5 MB). Support replies queue files until the reply is sent.
- **Push**: `public/sw.js` and `components/notification-center.tsx`.
  The unread count is polled every 30 seconds only while the tab is visible;
  the Goals page refreshes when the tab comes back into view.
- **Charts** (`recharts`) load on demand (`next/dynamic`) on the summary page.
- **Chat**: `components/chat/chat-provider.tsx` sits in the portal layout and
  owns the unlocked key, decrypted messages (memory only), the WebSocket
  (`lib/chat/socket.ts`: ticket, 25 s ping, back-off reconnect, catch-up with
  `after_seq`) and the drawer. The full page and the slide-up drawer
  (`chat-drawer.tsx`, hidden on `/chat`) share its components. Encryption is
  in `lib/chat/crypto.ts` (`libsodium-wrappers-sumo`); the unlocked key is kept
  in IndexedDB sealed with a server session secret (`lib/chat/keystore.ts`)
  and forgotten on sign-out before `/auth/logout` is called. The PIN screen
  is `components/chat/pin-input.tsx` (six circles over one numeric input). Thumbnails are
  made in the browser (`lib/chat/media.ts`). The S3 bucket's CORS must allow
  `GET` and `PUT` from the portal origin.

### 12.1 Accessibility and visual rules

The target is WCAG 2.2 AA (see `PRODUCT.md`). Checked with axe on every page
in light and dark mode, desktop and phone.

- **One `<h1>` per page.** A page that renders its own `<h1>` (a task, an
  asset, the users list) owns it; otherwise the header title is the `<h1>`
  (the layout detects this). Headings below go in order (`h2`, then `h3`).
- **Skip link** "Skip to main content" is the first focusable element; the
  content area is `#main-content`.
- **Every control has a name**: visible text, a `<Label htmlFor>`, or
  `aria-label` (icon-only buttons, filter dropdowns). Focus stays visible
  (`focus-visible:ring-ring`); never `focus:outline-none` alone.
- **Status text colours** must read at 4.5:1 on white, on a 10% tint of
  their colour and in dark mode: use `text-success-text` and
  `text-destructive-text` (theme tokens in `app/globals.css`) or a Tailwind
  `-700` shade with its `dark:` `-400`. The `-600` shades and `#16a34a` /
  `#dc2626` are for fills, borders and dots, not text. Brand-blue text
  (`#0d47a1`) needs `dark:text-[#38bdf8]` unless it sits on a white surface.
- **No faded text**: `text-muted-foreground` at full strength (opacity
  variants fall below 4.5:1).
- **Sizes**: labels and badges at least 11px; sentences at least 12px
  (`text-xs`).
- **Copy**: plain descriptions of what things are and do; no invented
  figures or claims (the sign-in page lists what the portal does).

## 13. Deployment and operations

### 13.1 Production layout

CapRover on one server, behind Cloudflare (`TRUSTED_PROXY_COUNT=2`).

| CapRover app | Image | Command |
|---|---|---|
| `incel-portal-api` | `ghcr.io/<owner>/incel-portal-backend:<sha>` | `python manage.py migrate --noinput && python manage.py collectstatic --noinput && gunicorn portalapi.wsgi:application --bind 0.0.0.0:8000 --workers 3 --timeout 120` |
| `incel-portal-celery-worker` | same backend image | `celery -A portalapi worker --loglevel=info` |
| `incel-portal-celery-beat` | same backend image | `celery -A portalapi beat --loglevel=info` |
| `incel-portal-realtime` | same backend image | `uvicorn portalapi.asgi:application --host 0.0.0.0 --port 8000 --workers 2 --proxy-headers` (WebSocket support on; domain `workspacews.incelgroup.com`) |
| `incel-portal-frontend` | `ghcr.io/<owner>/incel-portal-frontend:<sha>` | image default |

Postgres and Redis run as their own CapRover apps; look up their service
names with `docker service ls` (use the names that work in
`CELERY_BROKER_URL`). The backend image runs as an unprivileged user.

Set the backend variables of section 11 on all four backend apps. Required
in production beyond the defaults: `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=False`,
`DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS=https://workspace.incelgroup.com`,
`CSRF_TRUSTED_ORIGINS`, `PORTAL_BASE_URL`, `DB_*`, `CELERY_BROKER_URL`,
`CACHE_URL`, `CHANNEL_LAYER_URL`, `TRUSTED_PROXY_COUNT=2`, `ADMIN_ALLOWED_IPS`, AWS settings and
every `*_S3_PREFIX`, email settings, VAPID keys.

### 13.2 Releasing

Merging to `main` runs CI and, if everything passes, deploys the commit's
images to the four apps in order (API, worker, beat, web). Migrations run when
the API starts; a failing migration stops the API from starting. Before a
release with migrations, back up the database.

To roll back code, deploy an earlier commit's image in CapRover. Migrations
that add columns or rewrite data are not undone by that; restore the database
backup if the old code cannot run against the new schema.

### 13.3 After a release

1. `GET /health/` returns `{"status": "ok"}` (not `degraded`).
2. Sign in; the audit log shows your real IP.
3. `/admin/` opens from an allowed address; Email logs show new emails.
4. One upload of each kind works.

### 13.4 Backups

The database server runs a nightly backup script that keeps 30 backups per
database. Its location, commands and restore steps are kept with the
deployment notes outside this repository.

### 13.5 Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every API request returns 500, `/health/` was ok | Before 2026-11-17: wrong `CACHE_URL`. Now the API keeps working and `/health/` shows `degraded`; fix `CACHE_URL`. |
| Every change in the portal fails with "This request did not come from the portal." | `CORS_ALLOWED_ORIGINS` does not contain the web app's exact origin. |
| Staff are rate limited at busy times; `/admin/` refused from the office | `TRUSTED_PROXY_COUNT` too low (everyone looks like Cloudflare). |
| Uploads fail with "Could not verify the uploaded file" (503) | The AWS key cannot read that folder, or the folder setting is outside what the key may write. |
| Uploads fail before reaching the API | S3 refused the PUT: the folder setting is outside the key's permissions, or the bucket's CORS does not allow the web app's origin. |
| New users do not receive their set-password email | Email settings, or `PORTAL_BASE_URL`. Check Django admin → Email logs. |
| API container restarts repeatedly after a release | A migration failed (for example duplicate emails for the unique-email migration). Read the API log. |

## 14. Testing and quality gates

| Check | Command (from `api/` or `portal/`) |
|---|---|
| API tests (SQLite) | `python manage.py test` |
| API tests (Postgres) | `TEST_USE_SQLITE=false python manage.py test` |
| Lint | `uvx ruff check .` (pinned `ruff==0.17.5` in CI) |
| Missing migrations | `python manage.py makemigrations --check --dry-run` |
| Web lint and build | `npm run lint`, `npm run build` |
| End to end | `npm run test:e2e` (see `portal/e2e/README.md`) |

Expectations:
- Every new rule or fixed bug gets a test.
- Access-control changes update `common/tests/test_rbac_matrix.py`.
- Malformed input should be a 400 (`common/tests/test_bad_input.py` shows the
  pattern).
- Tests that touch storage mock `common.storage.s3_client` and switch on
  `VERIFY_UPLOADS` explicitly.
- The end-to-end API runs under uvicorn (`e2e/scripts/api-server.sh`) so the
  chat WebSocket works; `19-chat.spec.ts` stands in for S3 inside the browser.

CI (`.github/workflows/ci-cd.yml`) runs backend (Postgres), frontend and end
to end on every pull request into `main` and every push to `main`; images are
built and deployed only from `main` and only when all three pass.

## 15. Change history of contract-breaking changes

The November 2026 overhaul (security audit and API consistency work) changed
the API contract; the web app was updated at the same time. Anything written
against the old API must be updated:

- Routes: no trailing slashes; `admin/` prefix removed (`/admin/users` →
  `/users`, `/admin/applications` → `/applications`, `/admin/audit-logs` →
  `/audit-logs`, `/admin/organization/*` → `/organization/*`); summary routes
  are under `/summaries/weeks/{week}`; actions renamed (`add-comment` →
  `comments`, `update-status` → `status`, `upload-url` →
  `attachment-upload-url`, `confirm-upload` → `attachments`, `return_item` →
  `return`, `upload_photo_url` → `photo-upload-url`, `bulk_members` →
  `members`); `/me/applications`, `/goals/current` and `/tasks/drafts`
  removed; `/users/{id}/role`, `/department` and `/status` folded into
  `PATCH /users/{id}`.
- One pagination shape, one error shape, `_id` write fields, `search`
  parameter, JSON-only bodies, `PUT` only for a single value you own.
- Tokens only in cookies; cookie writes need a portal origin.
- Creating tasks or schedules returns `{count, results}`.
- Status codes: lockout 403, expired share 410, conflicts 409.

`GET /external/users` did not change.

The internal restructure that followed (view style, module split, model
conventions, input validation) changed no route, method, route name or
response, and needed no migration; the route table (section 3.5) guards it.

## 16. Common change scenarios

**New endpoint:** serializer for input → view with explicit permissions (a
`GenericViewSet` from `common.viewsets` with only the mixins needed; see
section 3.5) → route in the app's `api_urls.py` (`ApiRouter`, or an explicit
path) → tests for success, bad input and every role → add to the role test if
role-gated → update the route table (`UPDATE_ROUTE_TABLE=1`, section 3.5) →
`portal/lib/api/` function → this document (sections 5 and 7).

**New model:** inherit `TimeStampedModel` or `CreatedAtModel`, use
`settings.AUTH_USER_MODEL` for user fields and `TextChoices` for choices; put
a tasks-app model in the matching `tasks/models/<area>.py` and export it from
`tasks/models/__init__.py`.

**New list:** rely on the default pagination; parse filters with
`common/params.py`; return `Paginated<T>` in the portal and use
`hasNextPage()`.

**New upload:** presigned URL under a per-record folder, then
`checked_upload()` when recording it; allowlist the types; serve private
files with `presigned_download_url()`.

**New setting:** define it once in `settings.py` with a default, read it as
`settings.X`, add it to section 11, and to CapRover if production needs it.

**Changing access rules:** update `common/permissions.py` or the app's
permission classes, the role test, and section 5.

Documentation rule: see [DOCUMENTATION_POLICY.md](DOCUMENTATION_POLICY.md).
