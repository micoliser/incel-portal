import type { Page } from "@playwright/test";

import { SCHEDULES, TASKS } from "../support/seed";
import { expect, pageAs, test } from "../support/fixtures";
import { main } from "../support/ui";

const ASSIGNED_TO_STAN = [
  TASKS.pending, TASKS.inProgress, TASKS.underReview, TASKS.overdue, TASKS.completed,
  "Return hire van", "Label new shelving", "Clean loading bay",
];

function taskCards(page: Page) {
  return main(page).getByRole("link").filter({ has: page.getByRole("heading", { level: 3 }) });
}

test.describe("task lists for a staff member", () => {
  test.use({ role: "staff" });

  test("opens on the tasks assigned to them, newest first", async ({ page }) => {
    await page.goto("/tasks");
    await expect(taskCards(page).getByRole("heading", { level: 3 })).toHaveText(ASSIGNED_TO_STAN);
    await expect(main(page).getByRole("button", { name: "Team Tasks" })).toHaveCount(0);
  });

  test("shows status, priority, assignee and assigner on each card", async ({ page }) => {
    await page.goto("/tasks");
    const card = taskCards(page).filter({ hasText: TASKS.inProgress });
    await expect(card).toContainText("In Progress");
    await expect(card).toContainText("Medium");
    await expect(card).toContainText("Stan Staff");
    await expect(card).toContainText("by Mary");
    await expect(taskCards(page).filter({ hasText: TASKS.overdue })).toContainText("Overdue:");
  });

  test("filters by one status", async ({ page }) => {
    await page.goto("/tasks");
    await main(page).getByRole("button", { name: "Pending", exact: true }).click();
    await expect(taskCards(page).getByRole("heading", { level: 3 })).toHaveText([TASKS.pending, TASKS.overdue]);
  });

  test("combines several statuses", async ({ page }) => {
    await page.goto("/tasks");
    await main(page).getByRole("button", { name: "In Progress", exact: true }).click();
    await main(page).getByRole("button", { name: "Under Review", exact: true }).click();
    await expect(taskCards(page).getByRole("heading", { level: 3 })).toHaveText([TASKS.inProgress, TASKS.underReview]);
  });

  test("filters by priority", async ({ page }) => {
    await page.goto("/tasks");
    await main(page).getByRole("button", { name: "High", exact: true }).click();
    await expect(taskCards(page).getByRole("heading", { level: 3 })).toHaveText([
      TASKS.pending, TASKS.overdue, "Clean loading bay",
    ]);
  });

  test("combines a status with a priority", async ({ page }) => {
    await page.goto("/tasks");
    await main(page).getByRole("button", { name: "Completed", exact: true }).click();
    await main(page).getByRole("button", { name: "Low", exact: true }).click();
    await expect(taskCards(page).getByRole("heading", { level: 3 })).toHaveText([TASKS.completed]);
  });

  test("lists the tasks they created, and remembers the tab in the address", async ({ page }) => {
    await page.goto("/tasks");
    await main(page).getByRole("button", { name: "Created by Me" }).click();
    await expect(page).toHaveURL(/view=created/);
    await expect(taskCards(page).getByRole("heading", { level: 3 })).toHaveText([
      TASKS.createdByStaff, TASKS.createdByStaffInReview,
    ]);

    await page.reload();
    await expect(taskCards(page).getByRole("heading", { level: 3 })).toHaveText([
      TASKS.createdByStaff, TASKS.createdByStaffInReview,
    ]);
  });

  test("opens a task from its card", async ({ page }) => {
    await page.goto("/tasks");
    await taskCards(page).filter({ hasText: TASKS.inProgress }).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
    await expect(main(page).getByRole("heading", { level: 1, name: TASKS.inProgress })).toBeVisible();
  });
});

test.describe("task lists for a line manager", () => {
  test.use({ role: "manager" });

  test("has nothing assigned to them", async ({ page }) => {
    await page.goto("/tasks?view=assigned");
    await expect(taskCards(page)).toHaveCount(0);
  });

  test("sees every task in their department under Team Tasks", async ({ page }) => {
    await page.goto("/tasks");
    await main(page).getByRole("button", { name: "Team Tasks" }).click();
    await expect(page).toHaveURL(/view=team/);
    await expect(main(page).getByText("Department Line Manager: Operations")).toBeVisible();
    await expect(main(page).getByText("Viewing all tasks related to the Operations department.")).toBeVisible();

    const titles = taskCards(page).getByRole("heading", { level: 3 });
    await expect(titles).toHaveCount(11);
    for (const title of [...ASSIGNED_TO_STAN, TASKS.createdByStaff, TASKS.createdByStaffInReview, TASKS.otherTeam]) {
      await expect(titles.filter({ hasText: title })).toHaveCount(1);
    }
    await expect(titles.filter({ hasText: TASKS.itOnly })).toHaveCount(0);
  });

  test("lists the recurring schedules they created under Created by Me", async ({ page }) => {
    await page.goto("/tasks?view=created");
    for (const title of [SCHEDULES.active, SCHEDULES.paused, SCHEDULES.ended]) {
      await expect(main(page).getByText(title).first()).toBeVisible();
    }
  });
});

test.describe("task lists for a team lead", () => {
  test.use({ role: "lead" });

  test("sees only their own team's tasks under Team Tasks", async ({ page }) => {
    await page.goto("/tasks?view=team");
    await expect(main(page).getByText(/Team Lead/).first()).toBeVisible();
    const titles = taskCards(page).getByRole("heading", { level: 3 });
    await expect(titles.filter({ hasText: TASKS.pending })).toHaveCount(1);
    await expect(titles.filter({ hasText: TASKS.createdByStaff })).toHaveCount(1);
    await expect(titles.filter({ hasText: TASKS.otherTeam })).toHaveCount(0);
    await expect(titles.filter({ hasText: TASKS.itOnly })).toHaveCount(0);
  });
});

test.describe("task lists for an executive", () => {
  test.use({ role: "director" });

  test("sees tasks from every department under Team Tasks", async ({ page }) => {
    await page.goto("/tasks?view=team");
    const titles = taskCards(page).getByRole("heading", { level: 3 });
    for (const title of [TASKS.pending, TASKS.otherTeam, TASKS.itOnly]) {
      await expect(titles.filter({ hasText: title })).toHaveCount(1);
    }
  });
});

test.describe("task visibility", () => {
  test.use({ role: "peer" });

  test("a task that does not involve the user cannot be opened", async ({ page, browser }) => {
    // Find the address of a task between two other people, as someone who can see it.
    const director = await pageAs(browser, "director");
    await director.goto("/tasks?view=team");
    await director.getByRole("main").getByRole("link").filter({ hasText: TASKS.itOnly }).click();
    await expect(director).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
    const taskUrl = new URL(director.url()).pathname;
    await director.context().close();

    await page.goto(taskUrl);
    await expect(main(page).getByRole("heading", { name: "Failed to load task" })).toBeVisible();
    await expect(main(page).getByText("No Task matches the given query.")).toBeVisible();
  });
});
