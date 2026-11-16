import { expect, test } from "../support/fixtures";
import { expectSequence, main, sidebar } from "../support/ui";

test.describe("weekly goals for a staff member", () => {
  test.use({ role: "staff" });

  test("shows this week's goal with live progress", async ({ page }) => {
    await page.goto("/goals");
    const body = main(page);
    await expect(body.getByRole("heading", { level: 1, name: "Weekly Goals" })).toBeVisible();
    await expectSequence(body, "Active Targets", 1);
    await expectSequence(body, "Achieved", 0);
    await expectSequence(body, "Completion Rate", "0%");
    await expect(body.getByRole("paragraph").filter({ hasText: /^Tasks Completed$/ })).toBeVisible();
    await expect(body.getByText(/Target: 5 · Period: \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/)).toBeVisible();
    await expect(body).toContainText(/1\s*\/\s*5\s*\(20%\)/);
  });

  test("keeps the Set Goal button off until a metric and a target are chosen", async ({ page }) => {
    await page.goto("/goals");
    await expect(main(page).getByRole("button", { name: "Set Goal" })).toBeDisabled();
  });
});

test.describe("setting a goal", () => {
  test.use({ role: "clerk" });

  test("adds a goal for the current week and refuses a second one for the same metric", async ({ page }) => {
    await page.goto("/goals");
    const body = main(page);
    await expect(body.getByRole("heading", { level: 1, name: "Weekly Goals" })).toBeVisible();

    await expect(body.getByText("Set a Weekly Target")).toBeVisible();
    const metric = body.getByRole("combobox", { name: "Performance Metric" });
    const target = body.getByRole("spinbutton", { name: "Target Value" });
    const goalCard = body.getByRole("paragraph").filter({ hasText: /^Comments Added$/ });

    await metric.click();
    await page.getByRole("option", { name: "Comments Added" }).click();
    await target.fill("4");
    await body.getByRole("button", { name: "Set Goal" }).click();
    await expect(goalCard).toBeVisible();
    await expect(body.getByText(/Target: 4 · Period:/)).toBeVisible();

    // The metric now has a goal this week, so a second one is rejected.
    await metric.click();
    await page.getByRole("option", { name: "Comments Added" }).click();
    await target.fill("9");
    await body.getByRole("button", { name: "Set Goal" }).click();
    await expect(page.getByText(/Goal already exists for this week and metric/).first()).toBeVisible();
    await expect(body.getByText(/Target: 9 · Period:/)).toHaveCount(0);
  });

  test("is reachable from the sidebar", async ({ page }) => {
    await page.goto("/dashboard");
    await sidebar(page).getByRole("link", { name: "Goals" }).click();
    await expect(main(page).getByText("Set a Weekly Target")).toBeVisible();
  });
});
