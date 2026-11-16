import { test as base, expect, request, type Browser, type Page } from "@playwright/test";

import { API_URL, WEB_URL } from "../../playwright.config";
import { PASSWORD, USERS, type Role } from "./seed";

type StorageState = Awaited<ReturnType<Awaited<ReturnType<typeof request.newContext>>["storageState"]>>;

// Access tokens last five minutes and refresh tokens are single-use, so a saved
// session cannot be shared for a whole run. Each role's session is renewed
// before it gets close to expiry.
const SESSION_MAX_AGE_MS = 3 * 60 * 1000;
const sessions = new Map<Role, { state: StorageState; createdAt: number }>();

export async function sessionFor(role: Role): Promise<StorageState> {
  const cached = sessions.get(role);
  if (cached && Date.now() - cached.createdAt < SESSION_MAX_AGE_MS) {
    return withFreshActivity(cached.state);
  }

  const api = await request.newContext({ baseURL: `${API_URL}/` });
  const response = await api.post("auth/login", {
    data: { email: USERS[role].email, password: PASSWORD },
  });
  expect(response.ok(), `login as ${role} should succeed`).toBeTruthy();
  const state = await api.storageState();
  await api.dispose();

  sessions.set(role, { state, createdAt: Date.now() });
  return withFreshActivity(state);
}

/** The portal signs a user out when its last-activity marker is missing or old. */
function withFreshActivity(state: StorageState): StorageState {
  return {
    cookies: state.cookies,
    origins: [
      {
        origin: WEB_URL,
        localStorage: [
          { name: "portal_last_activity", value: String(Math.floor(Date.now() / 1000)) },
        ],
      },
    ],
  };
}

/**
 * `test.use({ role: "staff" })` signs the page in as that seeded user.
 * Without a role the page starts signed out.
 */
export const test = base.extend<{ role: Role | null }>({
  role: [null, { option: true }],
  // The callback is named `provide`, not Playwright's usual `use`, so the
  // React hooks lint rule does not mistake it for a hook call.
  storageState: async ({ role }, provide) => {
    await provide(role ? await sessionFor(role) : { cookies: [], origins: [] });
  },
});

export { expect };

/**
 * Opens a second signed-in browser session, for flows where two people act in
 * turn (an assigner and an assignee, a requester and a handler).
 */
export async function pageAs(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext({ storageState: await sessionFor(role) });
  return context.newPage();
}

/** A `YYYY-MM-DDTHH:mm` value, as typed into a date-and-time field, some days from now. */
export function dateTimeFromNow(days: number, time = "10:00"): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 10)}T${time}`;
}

/** Today's date in the portal's server timezone (UTC), as `YYYY-MM-DD`. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
