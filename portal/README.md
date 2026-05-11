# Incel Portal Frontend

This package contains the browser UI for Incel Portal. It is a Next.js App Router application that talks to the Django API in `api/` and renders the authenticated portal experience.

## What the frontend does

- handles login and session restoration with JWT tokens
- shows the dashboard, applications, tasks, logs, and notification center
- supports task creation, task detail views, comments, and status updates
- supports recurring task management, including schedule detail views, editing, pause/resume, and end actions
- keeps the selected task tab in the URL so the view is restored after refresh or navigation
- uses toast feedback, loading skeletons, and a shared portal layout for authenticated pages

## Key routes

- `/` - login page
- `/dashboard` - portal overview
- `/applications` - application browser and admin actions
- `/tasks` - task list with filters and infinite scroll
- `/tasks/[id]` - task detail view
- `/tasks/recurring/[id]` - recurring task detail and lifecycle controls
- `/logs` - audit log viewer

## Local development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The app expects the backend API base URL to be provided through `NEXT_PUBLIC_API_BASE_URL`.

## Notes

- The frontend is designed to run alongside the Django backend in `api/`.
- Static assets and the notification service worker live under `public/`.
- The portal uses TypeScript, Tailwind CSS, Lucide icons, Sonner, and date-fns.
