# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

About 65 Incel Group staff, most in Nigeria and some in Dubai, using the
portal through a working day, mostly on office desktops. Phones are occasional:
checking a task, a notification or a report on the move. Phone layouts must
work, but desktop is the main experience.

Roles, which decide what each person sees:

- **Staff:** do assigned tasks, keep to-dos and weekly goals, write daily
  reports, raise support requests, open internal applications, see the assets
  assigned to them.
- **Team leads, supervisors and line managers:** also give out and review
  work (approve or send back submitted tasks), follow their team's progress,
  and receive their team's daily reports and weekly summaries by email.
- **Executives:** a read-only view across the whole company, including the
  organization summary.
- **Administrators:** manage users, the organization structure (departments,
  units, teams, roles), the application catalogue and access, and the asset
  register; read the audit log.
- **Departments with a duty:** inventory staff manage assets and maintenance;
  IT and general support departments handle support requests.

## Product Purpose

One internal workspace where Incel Group staff manage and account for their
work: tasks with a review step, recurring schedules, to-dos, goals, daily
reports and weekly summaries; access to the company's internal applications;
support requests; and the company asset register. Success: people see what
they need to do and what their team is doing without asking anyone, managers
can review and follow up quickly, and every change is accountable.

## Positioning

Built for Incel Group's own structure and rules: the organization chart
(department, unit, team, direct manager) decides who sees, approves and is
emailed what; reports and summaries follow the company's working week in
Nigeria time; access to internal applications is granted by department, role
or individual exception; and every action is recorded in an audit log.

## Operating Context

- Sign-in by email and password; staff choose their own password from an
  emailed link. Sessions end after an hour without activity.
- Daily rhythm: tasks and to-dos through the day; daily reports written the
  same day; an end-of-day copy emailed at 5:05 PM Nigeria time to the author
  and their manager.
- Weekly rhythm: summaries created Monday at midnight and emailed at 8:00 AM,
  covering own work and work delegated to others.
- Emails, in-app notifications and browser push carry most prompts.
- Another internal service reads the user list through `/external/users`.

## Capabilities and Constraints

- Web app (Next.js) on a Django API; behind sign-in; no public pages beyond
  sign-in and password set-up/reset.
- Terminology in use: task, recurring schedule, to-do, goal, daily report,
  report entry (subreport), weekly summary, support request, asset,
  maintenance log, application, access override, audit log.
- Task statuses: Pending, In Progress, Under Review, Completed. Priorities:
  Low, Medium, High. Recurring schedules run in Nigeria (default) or Dubai
  time.
- Uploads: files up to 5 MB, stored privately and opened through short-lived
  links.
- User ids are integers and will stay so (a deliberate decision, 2026-11-18).
- Developer documentation: `docs/TECHNICAL_DOCUMENTATION.md`; staff guide:
  `docs/USER GUIDE.md`.

## Brand Commitments

- Names: "Incel Portal" (also "Incel Workspace"), for "Incel Group".
- The existing logo (`portal/public/logo2.png`, `portal/app/icon.png`) and the
  existing brand blue stay. The portal's emails follow the portal.
- Voice: plain, direct English that names things the way staff do.

## Evidence on Hand

Internal tool: no customers, testimonials, pricing or public claims exist,
and none should be invented. Real data lives in production; the end-to-end
seed (`api/accounts/management/commands/seed_e2e.py`) provides realistic test
people and records.

## Product Principles

1. **Clarity over persuasion.** It is a tool for daily work: every screen
   should answer "what do I need to do, and what is waiting on me?"
2. **Show what the organization chart says.** Who sees, approves and is told
   what follows department, team and manager; the interface makes that
   visible rather than surprising.
3. **Accountable by default.** Changes are recorded and attributable; the
   interface never hides who did what.
4. **Desktop first, never broken on a phone.**
5. **Plain language.** Labels and messages say what happened and what to do
   next; no marketing copy inside the tool.

## Accessibility & Inclusion

WCAG 2.2 AA for every screen: readable contrast (including status colours and
dark mode), full keyboard use with visible focus, accessible names for every
control, a sensible heading structure, and respect for reduced motion.
