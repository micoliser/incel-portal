# End-to-end tests

These tests drive the real portal in a browser against the real API and a real
Postgres database. They assert what a user sees on screen and almost never
mention an API URL or a response field, so a failure after an API change
usually means the portal's behaviour changed. (Two tests intercept a request:
one sign-in test simulates a server error, and one summary test adds a
manager's delegated-work figures, because the seeded people do not delegate
during the summary week.)

## Running

One-time setup:

```bash
sudo -u postgres createdb -O incel_portal_user incel_portal_e2e
```

```bash
npx playwright install chromium
```

Then, from `portal/`:

```bash
npm run test:e2e
```

This starts the API on port 8100 and a production build of the portal on port
3100, runs every test, and stops both. The HTML report is written to
`e2e/.report`; open it with `npm run test:e2e:report`.

If the bundled Chromium cannot start because system libraries are missing,
either run `sudo npx playwright install-deps chromium` or point the suite at a
browser that is already installed:

```bash
E2E_CHROMIUM_PATH=/snap/bin/chromium npm run test:e2e
```

## In CI

The `e2e-tests` job in `.github/workflows/ci-cd.yml` runs this suite on every
pull request into `main` and again on every push to `main`, against a Postgres
service named `incel_portal_e2e` and the browser Playwright installs. Images
are only built and deployed if it passes.
When it fails, the HTML report and failure screenshots are attached to the run
as the `e2e-report` artifact.

## What the run does

1. `e2e/scripts/api-server.sh` migrates the `incel_portal_e2e` database, wipes
   it, loads the fixed dataset with `manage.py seed_e2e`, and starts the API.
   Database host, user and password come from `api/.env`; only the database
   name is overridden.
2. The portal is built and served with `NEXT_PUBLIC_API_BASE_URL` pointing at
   that API.
3. Tests run one at a time, in file order.

The test API never sends email. Each message is written as a file to
`e2e/.mail/` (emptied at every start), which `e2e/support/mail.ts` reads so a
test can follow an emailed link, for example the one a new user sets their
password with. Browser push is switched off, and object storage points at an
unroutable address, so uploads are not covered (the test API also sets
`VERIFY_UPLOADS=False`). Your working database is never touched: `seed_e2e` refuses to run against a database
whose name does not end in `_e2e`.

## The dataset

`api/accounts/management/commands/seed_e2e.py` creates the data and
`e2e/support/seed.ts` mirrors the names the tests refer to. Change them
together. Everyone's password is the `PASSWORD` constant in `seed.ts`.

| Person | Role in the tests |
| --- | --- |
| Stan Staff | Ordinary staff member in Operations. Most read-only assertions, with exact counts, are made as Stan. |
| Mary Manager, Sam Supervisor, Lola Lead | Line manager, unit supervisor and team lead above Stan. |
| Pat Peer, Wale Warehouse | Colleagues in Operations, with an application allowance and denial respectively. |
| Ife Itmanager, Tolu Technician | IT line manager and IT staff: inventory and the IT support queue. |
| Hana Hrmanager | HR line manager: the queue for non-IT support requests. |
| Dele Director | Executive with read access to everything. |
| Ada Admin | Superuser, as administrators are in production. |
| Femi Finance, Chidi Clerk | The sandbox pair. Tests that create or change data act as them. |
| Ina Inbox | Holds the seeded notifications. |
| Chika Changer | Used for the change-password test and for being moved between departments. |
| Fola Former | Deactivated account. |

Tests that change data use the sandbox users and give new records unique
names, so the records behind the exact-count assertions do not move.

## Writing tests

- Use `test.use({ role: "staff" })` to start signed in as a seeded user.
- Use `pageAs(browser, "clerk")` for a second person in the same test.
- Assert visible text and controls. Do not assert on network requests.
- Labels and values are often separate elements; `expectSequence(scope,
  "Pending", 2)` checks they sit next to each other.

## Reusing running servers

While writing tests it is faster to keep the servers up:

```bash
bash e2e/scripts/api-server.sh
```

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8100/api/v1 npx next build && npx next start -p 3100
```

```bash
E2E_REUSE_SERVERS=1 npx playwright test 07-todos
```

The database is then not reseeded between runs. A few tests assert exact
totals that earlier runs change (users, inventory, notifications, the
change-password sequence), so restart the API script to reseed before trusting
a failure in those.

## Not covered

- File uploads and downloads (logos, photos, task and support attachments) and
  the summary PDF export: they need real object storage.
- The wording of emails (only the password links in them are used) and browser
  push delivery.
- Scheduled background jobs (recurring task generation, reminders, weekly
  summaries, auto-closing support requests).

## Behaviour that looks wrong

If a test has to pin down behaviour that looks like a defect, mark it
`KNOWN DEFECT` in the test file and say why, so a later fix updates it on
purpose. There are none at present.
