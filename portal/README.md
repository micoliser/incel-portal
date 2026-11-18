# Incel Portal web app

The browser application for Incel Portal: a Next.js 16 (App Router) app that
talks to the Django API in `../api`. Project overview and full setup are in the
[root README](../README.md); architecture and the API contract are in
[docs/TECHNICAL_DOCUMENTATION.md](../docs/TECHNICAL_DOCUMENTATION.md).

Read [AGENTS.md](AGENTS.md) before changing Next.js code: this Next.js version
differs from older documentation, and its own docs are in
`node_modules/next/dist/docs/`.

## Running

```bash
npm install
```

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1 npm run dev
```

Open http://localhost:3000. The API must be running, and its
`CORS_ALLOWED_ORIGINS` must include this address. Use the same host name for
both (`localhost` with `localhost`), so the sign-in cookies are sent.

`NEXT_PUBLIC_API_BASE_URL` is read at build time; production images are built
with the production API address.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | development server with hot reload |
| `npm run build` | production build |
| `npm run start` | serve the production build |
| `npm run lint` | ESLint |
| `npm run test:e2e` | Playwright end-to-end suite (see [e2e/README.md](e2e/README.md)) |
| `npm run test:e2e:report` | open the last end-to-end report |

## How it works

- **Sign-in and sessions**: the API sets HttpOnly cookies; the app never sees
  or stores a token. `lib/api-client.ts` sends cookies with every request, and
  on a 401 refreshes the session once and retries; if that fails it goes to the
  sign-in page and returns afterwards (`?next=`).
- **Signed-in area**: everything under `app/(portal)/`. `layout.tsx` loads the
  current user and permissions, guards admin-only pages, and builds the
  sidebar.
- **API calls** live in `lib/api/` (one module per area). Shared types are in
  `lib/api/types.ts`: `Paginated<T>` (every list response) and
  `hasNextPage()`.
- **Errors**: show `extractApiErrorMessage(error, fallback)` from
  `lib/api-errors.ts`. It reads the API's error envelope, and turns server
  failures and HTML error pages into a plain message.
- **Lists** keep only the newest response when filters change quickly (a
  request counter in each list page).
- **Uploads** go straight to S3 with presigned URLs. `lib/file-utils.ts`
  compresses images and stops files over 5 MB.
- **Browser push**: `public/sw.js` and `components/notification-center.tsx`.

## Pages

| Path | Page |
|---|---|
| `/` | sign-in |
| `/forgot-password`, `/reset-password` | password reset; also used to set a first password |
| `/dashboard` | overview |
| `/tasks`, `/tasks/[id]`, `/tasks/recurring/[id]` | tasks and recurring schedules |
| `/todos` | to-dos |
| `/goals` | weekly goals |
| `/reports`, `/reports/[date]`, `/reports/all`, `/reports/daily/[reportId]`, `/reports/subreports/[subreportId]` | daily reports |
| `/summaries`, `/summaries/[id]/files` | weekly summaries and sharing |
| `/organization-summary` | organization summary (executives) |
| `/applications` | application catalogue and management |
| `/support`, `/support/[id]` | support requests |
| `/inventory`, `/inventory/[id]`, `/inventory/maintenance` | asset register |
| `/my-assets` | assets assigned to me |
| `/users` | user management |
| `/departments` | organization structure |
| `/logs` | audit log |
