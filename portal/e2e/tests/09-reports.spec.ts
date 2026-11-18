import type { Page } from "@playwright/test";

import { REPORTS } from "../support/seed";
import { expect, pageAs, test, today } from "../support/fixtures";
import { expectSequence, expectToast, main, unique } from "../support/ui";

/**
 * Opens today's hub on the user's own tab with the entry form showing.
 * The first entry of the day is made through a "Create report" form; later
 * ones through "Add report". Both have the same two fields.
 */
async function openEntryForm(page: Page) {
  await page.goto(`/reports/${today()}`);
  const body = main(page);
  await body.getByRole("button", { name: /^My report/ }).click();
  const startFirstReport = body.getByRole("button", { name: "Create report" });
  const addToReport = body.getByRole("button", { name: "Add report" });
  await expect(startFirstReport.or(addToReport)).toBeVisible();
  if (await startFirstReport.isVisible()) {
    await startFirstReport.click();
  }
  await expect(body.getByRole("textbox", { name: "Report title" })).toBeVisible();
}

async function addReportEntry(page: Page, title: string, comment: string) {
  await openEntryForm(page);
  const body = main(page);
  await body.getByRole("textbox", { name: "Report title" }).fill(title);
  await body.getByRole("textbox", { name: "Comment" }).fill(comment);
  await body.locator('button[type="submit"]').click();
  await expect(body.getByRole("paragraph").filter({ hasText: title })).toBeVisible();
}

test.describe("daily reports for a staff member", () => {
  test.use({ role: "staff" });

  test("marks today on the calendar with the department's report count", async ({ page }) => {
    await page.goto("/reports");
    const body = main(page);
    await expect(body.getByText("Click a day to open the daily report hub.")).toBeVisible();
    await expect(body.getByText("Your report", { exact: true }).first()).toBeVisible();
    await expect(body.getByText("2 reports").first()).toBeVisible();
    await expect(body.getByRole("button", { name: "Prev" })).toBeVisible();
    await expect(body.getByRole("button", { name: "Next" })).toBeVisible();
  });

  test("shows their own entries for today in the day hub", async ({ page }) => {
    await page.goto(`/reports/${today()}`);
    const body = main(page);
    await expect(body.getByRole("button", { name: "My report 2" })).toBeVisible();
    await expect(body.getByRole("button", { name: "Department reports 2" })).toBeVisible();
    await expect(body.getByText("Stan Staff · Operations")).toBeVisible();
    for (const title of REPORTS.staffToday) {
      await expect(body.getByRole("paragraph").filter({ hasText: title })).toBeVisible();
    }
    await expect(body.getByText("Stan Staff · 1 comment")).toHaveCount(2);
  });

  test("shows colleagues from the same department, and nobody from other departments", async ({ page }) => {
    await page.goto(`/reports/${today()}`);
    const body = main(page);
    await body.getByRole("button", { name: "Department reports 2" }).click();
    await expect(body.getByText("Report for Pat Peer")).toBeVisible();
    await expect(body.getByText("Report for Stan Staff")).toBeVisible();
    await expect(body.getByText("Report for Tolu Technician")).toHaveCount(0);
    await expect(body.getByRole("link", { name: "View report" })).toHaveCount(2);
  });

  test("opens the full report and one of its entries", async ({ page }) => {
    await page.goto(`/reports/${today()}`);
    const body = main(page);
    await body.getByRole("link", { name: "Open full report" }).click();
    await expect(page).toHaveURL(/\/reports\/daily\/[0-9a-f-]{36}$/);
    await expectSequence(body, "Report owner", "Stan Staff");
    await expect(body.getByRole("button", { name: "Send to email" })).toBeVisible();

    await body.getByRole("link", { name: "View" }).first().click();
    await expect(page).toHaveURL(/\/reports\/subreports\/[0-9a-f-]{36}$/);
    await expectSequence(body, "Created by", "Stan Staff");
    await expectSequence(body, "Comments", 1);
    await expect(body.getByText("Loaded and sent out six vans before 9am.")).toBeVisible();
  });

  test("lists the department's reports day by day", async ({ page }) => {
    await page.goto("/reports/all");
    const body = main(page);
    await expect(body.getByRole("heading", { level: 1, name: "Department Daily Reports" })).toBeVisible();
    await expect(body.getByText("4 reports across 2 days")).toBeVisible();
    await expect(body.getByRole("heading", { level: 2 })).toHaveCount(2);
    await expectSequence(body, "Today", "2 reports submitted");
    await expectSequence(body, "Yesterday", "2 reports submitted");
    await expect(body.getByText(REPORTS.peerToday)).toBeVisible();
    await expect(body.getByText(REPORTS.staffYesterday)).toBeVisible();
    await expect(body.getByText(REPORTS.itToday)).toHaveCount(0);
    await expect(body.getByText("All department reports have been loaded.")).toBeVisible();
  });

  test("searches the department list by person", async ({ page }) => {
    await page.goto("/reports/all");
    const body = main(page);
    await body.getByRole("textbox", { name: "Search by username or email..." }).fill("peer");
    await expect(body.getByText("2 reports across 2 days")).toBeVisible();
    await expect(body.getByText(REPORTS.peerToday)).toBeVisible();
    await expect(body.getByText(REPORTS.staffToday[0])).toHaveCount(0);
  });

  test("cannot open a report from another department", async ({ page, browser }) => {
    const technician = await pageAs(browser, "itstaff");
    await technician.goto(`/reports/${today()}`);
    await technician.getByRole("main").getByRole("link", { name: "Open full report" }).click();
    await expect(technician).toHaveURL(/\/reports\/daily\/[0-9a-f-]{36}$/);
    const path = new URL(technician.url()).pathname;
    await technician.context().close();

    await page.goto(path);
    await expect(main(page).getByText(REPORTS.itToday)).toHaveCount(0);
    await expect(page.getByText(/Forbidden|permission|Unable to load|Failed to load/i).first()).toBeVisible();
  });
});

test.describe("daily reports for an executive", () => {
  test.use({ role: "director" });

  test("sees reports from every department", async ({ page }) => {
    await page.goto("/reports/all");
    const body = main(page);
    await expect(body.getByText(REPORTS.itToday)).toBeVisible();
    await expect(body.getByText(REPORTS.peerToday)).toBeVisible();
  });
});

test.describe("writing a daily report", () => {
  test.use({ role: "clerk" });

  test("requires both a title and a comment", async ({ page }) => {
    await openEntryForm(page);
    const body = main(page);
    await body.locator('button[type="submit"]').click();
    await expect(body.getByText("A report title is required.")).toBeVisible();

    await body.getByRole("textbox", { name: "Report title" }).fill("Title only");
    await body.locator('button[type="submit"]').click();
    await expect(body.getByText(/comment is required/i)).toBeVisible();
    await expect(body.getByRole("paragraph").filter({ hasText: "Title only" })).toHaveCount(0);
  });

  test("adds an entry to today's report and shows it in the full report", async ({ page }) => {
    const title = unique("Posted supplier invoices");
    await addReportEntry(page, title, "Posted nine invoices to the ledger.");
    const body = main(page);
    await expect(body.getByRole("textbox", { name: "Report title" })).toHaveValue("");

    await body.getByRole("link", { name: "Open full report" }).click();
    await expect(page).toHaveURL(/\/reports\/daily\/[0-9a-f-]{36}$/);
    await expect(body.getByRole("paragraph").filter({ hasText: title })).toBeVisible();
    await expectSequence(body, "Report owner", "Chidi Clerk");
  });

  test("adds a follow-up comment to an entry", async ({ page }) => {
    const title = unique("Reconciled bank feed");
    await addReportEntry(page, title, "Matched all lines for Monday.");
    const body = main(page);

    const entry = body.locator("div").filter({ has: page.getByRole("paragraph").filter({ hasText: title }) })
      .filter({ has: page.getByRole("link", { name: "View" }) }).last();
    await entry.getByRole("link", { name: "View" }).click();
    await expect(page).toHaveURL(/\/reports\/subreports\/[0-9a-f-]{36}$/);
    await expect(body.getByText("Matched all lines for Monday.")).toBeVisible();

    await body.getByRole("textbox", { name: "Comment" }).fill("Tuesday is done as well.");
    await body.getByRole("button", { name: "Append comment" }).click();
    await expect(body.getByText("Tuesday is done as well.")).toBeVisible();
    await expectSequence(body, "Comments", 2);
  });

  test("adds an entry from the full report page", async ({ page }) => {
    await addReportEntry(page, unique("Opened the day"), "First entry of the day.");
    const body = main(page);
    await body.getByRole("link", { name: "Open full report" }).click();
    await expect(page).toHaveURL(/\/reports\/daily\/[0-9a-f-]{36}$/);

    const title = unique("Filed receipts");
    await body.getByRole("textbox", { name: "Title" }).fill(title);
    await body.getByRole("textbox", { name: "Comment" }).fill("Filed the week's receipts.");
    await body.getByRole("button", { name: "Add report" }).click();
    await expect(body.getByRole("paragraph").filter({ hasText: title })).toBeVisible();
  });

  test("forwards the report by email to a colleague", async ({ page }) => {
    await addReportEntry(page, unique("Closed the till"), "Balanced to the penny.");
    const body = main(page);
    await body.getByRole("link", { name: "Open full report" }).click();
    await body.getByRole("button", { name: "Send to email" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox").first().fill("finance@e2e.test");
    // Send once. (Enter in the field would also submit the form, and pressing
    // it before clicking made the test send twice or wait on a closed dialog.)
    await dialog.getByRole("button", { name: /^Send/ }).click();
    await expectToast(page, /forwarded to 1 recipient/i);
  });
});
