import type { APIRequestContext } from "@playwright/test";

import { API_URL } from "../../playwright.config";
import { expect, test } from "../support/fixtures";
import { main } from "../support/ui";

test.describe("audit logs for an administrator", () => {
  test.use({ role: "admin" });

  test("lists events with time, actor, action and address", async ({ page }) => {
    await page.goto("/logs");
    const body = main(page);
    await expect(body.getByRole("heading", { level: 1, name: "Audit & Activity Logs" })).toBeVisible();
    await expect(body.getByRole("columnheader")).toHaveText([
      "Timestamp", "Actor", "Event / Action", "IP Address", "Metadata",
    ]);
    await expect(body.getByText("Audit Logging Active")).toBeVisible();
    await expect(body.getByRole("row").filter({ hasText: "AUTH_LOGIN_SUCCESS" }).first()).toContainText(
      "User logged in successfully.",
    );
  });

  // The search box filters the events on the current page only, and the list is
  // newest first, so each of these tests makes its own event to look for.
  async function failSignIn(request: APIRequestContext): Promise<string> {
    const email = `probe-${Date.now()}@e2e.test`;
    await request.post(`${API_URL}/auth/login`, { data: { email, password: "Wrong-Password-1" } });
    return email;
  }

  test("records a failed sign-in and describes it in plain language", async ({ page, request }) => {
    const email = await failSignIn(request);
    await page.goto("/logs");
    const body = main(page);
    await body.getByRole("textbox", { name: "Search actor, event, IP, code..." }).fill(email);
    const row = body.getByRole("row").filter({ hasText: `Login failed for ${email}.` });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("AUTH_LOGIN_FAILED");
    await expect(row).toContainText("AUTH");
    await expect(body.getByRole("row")).toHaveCount(2);
  });

  test("reveals an event's metadata on request", async ({ page, request }) => {
    const email = await failSignIn(request);
    await page.goto("/logs");
    const body = main(page);
    await body.getByRole("textbox", { name: "Search actor, event, IP, code..." }).fill(email);
    const row = body.getByRole("row").filter({ hasText: `Login failed for ${email}.` });
    await row.getByText("View Metadata").click();
    await expect(row.getByText(/"email"/)).toBeVisible();
  });

  test("offers time-range filters", async ({ page }) => {
    await page.goto("/logs");
    const body = main(page);
    for (const name of ["All Logs", "Last 24 Hours", "Last 7 Days", "Last 30 Days", "Specific Date", "Date Range"]) {
      await expect(body.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await body.getByRole("button", { name: "Last 24 Hours" }).click();
    await expect(body.getByRole("row").filter({ hasText: "AUTH_LOGIN_SUCCESS" }).first()).toBeVisible();
  });
});

test.describe("audit logs for an executive", () => {
  test.use({ role: "director" });

  test("are readable", async ({ page }) => {
    await page.goto("/logs");
    await expect(main(page).getByRole("heading", { level: 1, name: "Audit & Activity Logs" })).toBeVisible();
    await expect(main(page).getByRole("row").filter({ hasText: "AUTH_LOGIN_SUCCESS" }).first()).toBeVisible();
  });
});
