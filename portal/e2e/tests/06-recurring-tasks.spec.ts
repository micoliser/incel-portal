import type { Page } from "@playwright/test";

import { SCHEDULES, USERS } from "../support/seed";
import { dateTimeFromNow, expect, pageAs, test } from "../support/fixtures";
import { expectSequence, main, unique } from "../support/ui";

function scheduleLinks(page: Page) {
  return main(page).getByRole("link").filter({ hasText: /Every \d+[dw]/ });
}

async function openSchedule(page: Page, title: string) {
  await page.goto("/tasks?view=created");
  await scheduleLinks(page).filter({ hasText: title }).click();
  await expect(page).toHaveURL(/\/tasks\/recurring\/[0-9a-f-]{36}$/);
  await expect(main(page).getByRole("heading", { level: 1, name: title })).toBeVisible();
}

async function createSchedule(page: Page, title: string) {
  await page.goto("/tasks");
  await main(page).getByRole("button", { name: "Create Task" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Task" });
  await dialog.getByRole("button", { name: "Recurring Task" }).click();
  await dialog.getByRole("textbox", { name: "Task Title *" }).fill(title);
  await dialog.getByRole("textbox", { name: "Assign To *" }).fill("chidi");
  await dialog.getByRole("button", { name: `${USERS.clerk.name} (${USERS.clerk.email})` }).click();
  await dialog.getByRole("textbox", { name: "Start At" }).fill(dateTimeFromNow(1));
  await dialog.getByRole("checkbox", { name: "Include Weekends" }).check();
  await dialog.getByRole("button", { name: "Create Schedule" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("recurring schedules for their creator", () => {
  test.use({ role: "manager" });

  test("are listed with their state under Created by Me", async ({ page }) => {
    await page.goto("/tasks?view=created");
    await expect(main(page).getByRole("heading", { name: "Recurring Tasks You Created" })).toBeVisible();
    await expect(main(page).getByText("3 total")).toBeVisible();
    await expect(scheduleLinks(page).filter({ hasText: SCHEDULES.active })).toContainText("Active");
    await expect(scheduleLinks(page).filter({ hasText: SCHEDULES.paused })).toContainText("Paused");
    await expect(scheduleLinks(page).filter({ hasText: SCHEDULES.ended })).toContainText("Ended");
    await expect(scheduleLinks(page).filter({ hasText: SCHEDULES.ended })).toContainText("Next run: N/A");
  });

  test("show cadence, run times, deadline offset and the people involved", async ({ page }) => {
    await openSchedule(page, SCHEDULES.active);
    const body = main(page);
    await expect(body.getByText("Walk-round check before first dispatch.")).toBeVisible();
    await expectSequence(body, "Cadence", "Every day", "Includes Sat & Sun");
    await expectSequence(body, "Run Times", "09:00", "UTC");
    await expectSequence(body, "Deadline Offset", "8h");
    await expect(body.getByText("Every day (including weekends)")).toBeVisible();
    await expect(body.getByText("8h (480 minutes)")).toBeVisible();
    await expect(body.getByText("Ongoing (No end date)")).toBeVisible();
    await expect(body.getByText("Stan Staff")).toBeVisible();
    await expect(body.getByText("Mary Manager")).toBeVisible();
  });

  test("offer pause, edit and end on an active schedule", async ({ page }) => {
    await openSchedule(page, SCHEDULES.active);
    await expect(main(page).getByRole("button", { name: "Pause Schedule" })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "End Schedule" })).toBeVisible();
  });

  test("offer resume on a paused schedule and nothing on an ended one", async ({ page }) => {
    await openSchedule(page, SCHEDULES.paused);
    await expect(main(page).getByRole("button", { name: "Resume Schedule" })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Pause Schedule" })).toHaveCount(0);

    await openSchedule(page, SCHEDULES.ended);
    await expect(main(page).getByRole("button", { name: /Schedule$/ })).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  });
});

test.describe("recurring schedules for the assignee", () => {
  test.use({ role: "staff" });

  test("can be read but not changed", async ({ page, browser }) => {
    const manager = await pageAs(browser, "manager");
    await openSchedule(manager, SCHEDULES.active);
    const path = new URL(manager.url()).pathname;
    await manager.context().close();

    await page.goto(path);
    await expect(main(page).getByRole("heading", { level: 1, name: SCHEDULES.active })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Pause Schedule" })).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: "End Schedule" })).toHaveCount(0);
  });
});

test.describe("managing a recurring schedule", () => {
  test.use({ role: "finance" });

  test("creates a daily schedule and lists it as active", async ({ page }) => {
    const title = unique("Daily cash count");
    await createSchedule(page, title);

    await page.goto("/tasks?view=created");
    const link = scheduleLinks(page).filter({ hasText: title });
    await expect(link).toContainText("Active");
    await expect(link).toContainText("Every 1d");
    await expect(link).toContainText("Chidi Clerk");

    await link.click();
    await expect(main(page).getByText("Every day (including weekends)")).toBeVisible();
    // The form defaults to one run at the start time, in the Dubai timezone.
    await expectSequence(main(page), "Run Times", "10:00", "Asia/Dubai");
  });

  test("pauses, resumes and then ends a schedule", async ({ page }) => {
    const title = unique("Daily bank check");
    await createSchedule(page, title);
    await openSchedule(page, title);
    const body = main(page);

    await body.getByRole("button", { name: "Pause Schedule" }).click();
    await expect(body.getByRole("button", { name: "Resume Schedule" })).toBeVisible();
    await expect(body.getByText("Paused").first()).toBeVisible();

    await body.getByRole("button", { name: "Resume Schedule" }).click();
    await expect(body.getByRole("button", { name: "Pause Schedule" })).toBeVisible();

    await body.getByRole("button", { name: "End Schedule" }).click();
    const ending = page.getByRole("dialog", { name: "End Recurring Task Schedule?" });
    await expect(ending).toContainText(`Are you sure you want to end "${title}"?`);
    await ending.getByRole("button", { name: "End Schedule" }).click();
    await expect(ending).toBeHidden();
    await expect(body.getByText("Ended").first()).toBeVisible();
    await expect(body.getByRole("button", { name: "Pause Schedule" })).toHaveCount(0);
    await expect(body.getByRole("button", { name: "End Schedule" })).toHaveCount(0);
  });

  test("edits the title and priority of a schedule", async ({ page }) => {
    const title = unique("Daily till check");
    await createSchedule(page, title);
    await openSchedule(page, title);

    await main(page).getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const renamed = `${title} v2`;
    await dialog.getByRole("textbox", { name: /Title/ }).fill(renamed);
    await dialog.getByRole("combobox", { name: "Priority" }).selectOption("high");
    await dialog.getByRole("button", { name: /Save|Update/ }).click();
    await expect(dialog).toBeHidden();
    await expect(main(page).getByRole("heading", { level: 1, name: renamed })).toBeVisible();
    await expect(main(page).getByText("High Priority")).toBeVisible();
  });
});
