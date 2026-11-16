import { APPS, TASKS } from "../support/seed";
import { expect, test } from "../support/fixtures";
import { expectSequence, main } from "../support/ui";

test.describe("dashboard for a staff member", () => {
  test.use({ role: "staff" });

  test("summarises the tasks assigned to them", async ({ page }) => {
    await page.goto("/dashboard");
    const body = main(page);
    await expect(body.getByText("Role: Staff · Operations")).toBeVisible();
    await expect(body.getByRole("button", { name: "Assigned to Me 8" })).toBeVisible();
    await expect(body.getByRole("button", { name: "Tasks I Assigned 2" })).toBeVisible();
    await expect(body.getByText("You have 8 tasks assigned to you.")).toBeVisible();
    await expectSequence(body, "Assigned Tasks", 8);
    await expectSequence(body, "Pending", 2, "Tasks not yet started.");
    await expectSequence(body, "In Progress", 1, "Tasks you're actively working on.");
    await expectSequence(body, "High Priority", 2, "Urgent tasks needing attention.");
    await expect(body.getByText("3 tasks due soon or overdue")).toBeVisible();
  });

  test("lists the five most recent assigned tasks with assigner and assignee", async ({ page }) => {
    await page.goto("/dashboard");
    const body = main(page);
    for (const title of [TASKS.pending, TASKS.inProgress, TASKS.underReview, TASKS.overdue, TASKS.completed]) {
      await expect(body.getByText(title, { exact: true })).toBeVisible();
    }
    await expect(body.getByRole("button", { name: "View task" })).toHaveCount(5);
    await expectSequence(body, "By:", "Mary Manager", "•", "To:", "Stan Staff");
  });

  test("switches to the tasks they assigned to others", async ({ page }) => {
    await page.goto("/dashboard");
    const body = main(page);
    await body.getByRole("button", { name: "Tasks I Assigned 2" }).click();
    await expect(body.getByText("You have assigned 2 tasks to others.")).toBeVisible();
    await expect(body.getByText(TASKS.createdByStaff, { exact: true })).toBeVisible();
    await expect(body.getByText(TASKS.createdByStaffInReview, { exact: true })).toBeVisible();
    await expectSequence(body, "By:", "Stan Staff", "•", "To:", "Pat Peer");
  });

  test("opens a task from its card", async ({ page }) => {
    await page.goto("/dashboard");
    const body = main(page);
    await body.getByRole("button", { name: "View task" }).first().click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
    await expect(body.getByRole("heading", { level: 1, name: TASKS.pending })).toBeVisible();
  });

  test("shows the recently opened application", async ({ page }) => {
    await page.goto("/dashboard");
    const body = main(page);
    await expect(body.getByText("Recent applications")).toBeVisible();
    await expect(body.getByText(APPS.payroll, { exact: true })).toBeVisible();
    await expect(body.getByRole("button", { name: "Open Application" })).toHaveCount(1);
  });

  test("quick actions lead to tasks and applications", async ({ page }) => {
    await page.goto("/dashboard");
    await main(page).getByRole("button", { name: /View all tasks/ }).click();
    await expect(page).toHaveURL(/\/tasks/);
    await page.goto("/dashboard");
    await main(page).getByRole("button", { name: /View applications/ }).click();
    await expect(page).toHaveURL("/applications");
  });
});

test.describe("dashboard for a line manager", () => {
  test.use({ role: "manager" });

  test("opens on the tasks they delegated", async ({ page }) => {
    await page.goto("/dashboard");
    const body = main(page);
    await expect(body.getByText("Role: Line Manager · Operations")).toBeVisible();
    await expect(body.getByText("Monitoring tasks you assigned to team members.")).toBeVisible();
    await expect(body.getByRole("button", { name: "Tasks I Assigned 8" })).toBeVisible();
    await expect(body.getByText("You have assigned 8 tasks to others.")).toBeVisible();
    await expectSequence(body, "Tasks Delegated", 8);
    await expectSequence(body, "Under Review", 1, "Tasks submitted and awaiting your review.");
    await expectSequence(body, "Completed", 4, "Tasks completed by your assignees.");
  });
});
