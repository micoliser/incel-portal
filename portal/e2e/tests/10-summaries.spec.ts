import { expect, pageAs, test } from "../support/fixtures";
import { expectSequence, expectToast, main } from "../support/ui";

test.describe("weekly summary for a staff member", () => {
  test.use({ role: "staff" });

  test("opens on the most recent week with its headline figures", async ({ page }) => {
    await page.goto("/summaries");
    const body = main(page);
    await expect(
      body.getByRole("heading", {
        level: 1,
        name: "You created 0 task(s), completed 3 of 3 assigned task(s) (100.0%), and added 0 comment(s).",
      }),
    ).toBeVisible();
    await expectSequence(body, "Task Completion", "3", "/ 3 assigned");
    await expect(body.getByText("100% completion rate")).toBeVisible();
    await expectSequence(body, "On-Time Rate", "100%");
    await expectSequence(body, "Tasks Created", "0");
    await expect(body.getByRole("button", { name: /Most Recent/ })).toBeVisible();
    await expect(body.getByRole("complementary").getByRole("button").filter({ hasText: /\d{4}/ })).toHaveCount(2);
  });

  test("breaks the week down by priority and status", async ({ page }) => {
    await page.goto("/summaries");
    const body = main(page);
    await expectSequence(body, "By Priority Level", "high", 1, "medium", 2);
    await expectSequence(body, "By Status", "Completed", 3);
  });

  test("compares the week with the one before", async ({ page }) => {
    await page.goto("/summaries");
    const body = main(page);
    await expect(body.getByText("Week-over-Week Comparison")).toBeVisible();
    await expect(body.getByText("Improving Momentum")).toBeVisible();
    await expectSequence(body, "Tasks Completed", "+3", "3", "Prev: 0");
    await expectSequence(body, "High Priority Tasks", "+1", "1", "Prev: 0");
  });

  test("switches to an earlier week", async ({ page }) => {
    await page.goto("/summaries");
    const body = main(page);
    await body.getByRole("complementary").getByRole("button").filter({ hasText: /\d{4}/ }).nth(1).click();
    await expect(page).toHaveURL(/\/summaries\?id=\d{4}-\d{2}-\d{2}$/);
    await expect(
      body.getByRole("heading", {
        level: 1,
        name: "You created 0 task(s), completed 0 of 0 assigned task(s) (0%), and added 0 comment(s).",
      }),
    ).toBeVisible();
    await expectSequence(body, "Task Completion", "0", "/ 0 assigned");
  });

  test("opens the files attached and received during the week", async ({ page }) => {
    await page.goto("/summaries");
    const body = main(page);
    await body.getByRole("link", { name: /Files Attached/ }).click();
    await expect(page).toHaveURL(/\/summaries\/[0-9a-f-]{36}\/files/);
    await expect(body.getByRole("heading", { level: 1, name: "Files Attached" })).toBeVisible();
    await expect(body.getByRole("heading", { name: "No files attached this week" })).toBeVisible();

    await body.getByRole("button", { name: "Files Received", exact: true }).click();
    await expect(body.getByRole("heading", { level: 1, name: "Files Received" })).toBeVisible();
    await body.getByRole("button", { name: "Back to Summary" }).click();
    await expect(page).toHaveURL(/\/summaries/);
  });
});

test.describe("sharing a weekly summary", () => {
  test.use({ role: "clerk" });

  test("creates a share link that another signed-in user can open, then revokes it", async ({ page, browser }) => {
    await page.goto("/summaries");
    const body = main(page);
    await expect(body.getByText("Share This Summary")).toBeVisible();

    await body.getByRole("button", { name: "Create Public Share Link" }).click();
    await page.getByRole("dialog", { name: "Create Public Share Link" }).getByRole("button", { name: "Confirm & Create" }).click();
    await expectToast(page, "Share link created! Copy it to share.");

    const linkBox = body.getByRole("textbox").last();
    await expect(linkBox).toHaveValue(/\/summaries\?token=[\w-]{40,}$/);
    const shareUrl = new URL(await linkBox.inputValue());

    const finance = await pageAs(browser, "finance");
    await finance.goto(shareUrl.pathname + shareUrl.search);
    await expect(
      finance.getByRole("main").getByRole("heading", { level: 1, name: "Chidi Clerk's Weekly Summary" }),
    ).toBeVisible();
    await expect(finance.getByRole("main").getByText("Shared Report")).toBeVisible();
    await expect(finance.getByRole("main").getByRole("button", { name: "Create Public Share Link" })).toHaveCount(0);

    // The link is shown only when it is created. After a reload the page says
    // that one exists, without revealing it.
    await page.reload();
    await expect(body.getByText(/A public share link is active until/)).toBeVisible();
    await expect(body.locator('input[value*="token="]')).toHaveCount(0);
    await expect(body.getByRole("button", { name: "Create New Link" })).toBeVisible();

    await body.getByRole("button", { name: "Revoke Link" }).click();
    const revoking = page.getByRole("dialog", { name: "Revoke Share Link" });
    await revoking.getByRole("button", { name: "Revoke Link" }).click();
    await expect(revoking).toBeHidden();
    await expect(body.getByRole("button", { name: "Create Public Share Link" })).toBeVisible();

    await finance.reload();
    await expect(finance.getByText(/Invalid share link|not found|no longer|unable/i).first()).toBeVisible();
    await finance.context().close();
  });

  test("shares the summary with one colleague, who is notified", async ({ page, browser }) => {
    await page.goto("/summaries");
    const body = main(page);
    await body.getByRole("button", { name: "Share with user" }).click();
    const dialog = page.getByRole("dialog", { name: "Share Summary with Colleague" });
    await dialog.getByRole("textbox", { name: /Search by name/ }).fill("femi");
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText(/Shared|Access granted|Revoke/i).first()).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    const finance = await pageAs(browser, "finance");
    await finance.goto("/dashboard");
    await finance.getByRole("button", { name: "Open notifications" }).click();
    await expect(finance.getByText(/clerk@e2e\.test shared a weekly summary/).first()).toBeVisible();
    await finance.context().close();
  });
});

test.describe("organization summary", () => {
  test.use({ role: "director" });

  test("shows company-wide figures for the latest week to an executive", async ({ page }) => {
    await page.goto("/organization-summary");
    const body = main(page);
    await expect(body.getByRole("heading", { level: 1, name: "Organization Summary" })).toBeVisible();
    await expectSequence(body, "Tasks Completed", "3", "+3");
    await expect(body.getByText("of 3 total assigned tasks")).toBeVisible();
    await expect(body.getByRole("heading", { name: "Tasks by Priority" })).toBeVisible();
    await expect(body.getByRole("heading", { name: "Week-over-Week Comparison" })).toBeVisible();
    await expect(body.getByText("Performance Trending Up")).toBeVisible();
  });
});
