import type { Page } from "@playwright/test";

import { TICKETS } from "../support/seed";
import { expect, pageAs, test } from "../support/fixtures";
import { choose, expectSequence, main, unique } from "../support/ui";

function ticketCards(page: Page) {
  return main(page).getByRole("button").filter({ has: page.getByRole("heading", { level: 3 }) });
}

async function openTicket(page: Page, title: string) {
  await ticketCards(page).filter({ hasText: title }).click();
  await expect(page).toHaveURL(/\/support\/[0-9a-f-]{36}$/);
  await expect(main(page).getByRole("heading", { level: 1, name: title })).toBeVisible();
}

async function submitRequest(page: Page, title: string, options: { category?: string; priority?: string } = {}) {
  await page.goto("/support");
  await main(page).getByRole("button", { name: "New Request" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New Support Request" });
  await dialog.getByRole("textbox", { name: "Title" }).fill(title);
  if (options.category) {
    await choose(page, dialog.getByRole("combobox", { name: "Category" }), options.category);
  }
  if (options.priority) {
    await choose(page, dialog.getByRole("combobox", { name: "Priority" }), options.priority);
  }
  await dialog.getByRole("textbox", { name: "Description" }).fill("Raised by an end-to-end test.");
  await dialog.getByRole("button", { name: "Submit Request" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("support requests for a staff member", () => {
  test.use({ role: "staff" });

  test("lists their own requests with counts per state", async ({ page }) => {
    await page.goto("/support");
    const body = main(page);
    await expectSequence(body, "Total Requests", 4);
    await expectSequence(body, "Awaiting Action", 2);
    await expectSequence(body, "In Progress", 1, "active handling");
    await expectSequence(body, "Resolved & Closed", 1);
    await expect(body.getByRole("button", { name: "My Requests 4" })).toBeVisible();
    await expect(body.getByRole("button", { name: "Department Requests" })).toHaveCount(0);
    await expect(ticketCards(page).getByRole("heading", { level: 3 })).toHaveText([
      TICKETS.hr, TICKETS.resolved, TICKETS.inProgress, TICKETS.open,
    ]);
    await expect(body.getByText(TICKETS.peer)).toHaveCount(0);
  });

  test("shows category, state, routing department and handler on each card", async ({ page }) => {
    await page.goto("/support");
    const hr = ticketCards(page).filter({ hasText: TICKETS.hr });
    await expect(hr).toContainText("General");
    await expect(hr).toContainText("Human Resources");
    await expect(hr).toContainText("Unassigned");
    const inProgress = ticketCards(page).filter({ hasText: TICKETS.inProgress });
    await expect(inProgress).toContainText("IT Support");
    await expect(inProgress).toContainText("In Progress");
    await expectSequence(inProgress, "Assigned:", "Tolu Technician");
  });

  test("filters by state and by search text", async ({ page }) => {
    await page.goto("/support");
    const body = main(page);
    await body.getByRole("button", { name: "Open 2" }).click();
    await expect(ticketCards(page).getByRole("heading", { level: 3 })).toHaveText([TICKETS.hr, TICKETS.open]);
    // The counts on the state buttons follow the filtered list, so match by label only.
    await body.getByRole("button", { name: /^Resolved/ }).click();
    await expect(ticketCards(page).getByRole("heading", { level: 3 })).toHaveText([TICKETS.resolved]);
    await body.getByRole("button", { name: /^All Status/ }).click();
    await expect(ticketCards(page)).toHaveCount(4);
    await body.getByRole("textbox", { name: "Search by title or requester..." }).fill("signature");
    await expect(ticketCards(page).getByRole("heading", { level: 3 })).toHaveText([TICKETS.inProgress]);
  });

  test("shows a request's details, discussion and handler", async ({ page }) => {
    await page.goto("/support");
    await openTicket(page, TICKETS.inProgress);
    const body = main(page);
    await expect(body.getByText("Email signature is wrong. Seeded for end-to-end tests.")).toBeVisible();
    await expect(body.getByText("Discussion & Activity (2)")).toBeVisible();
    await expect(body.getByText("Support request submitted — IT Support, Low priority.")).toBeVisible();
    await expect(body.getByText("I have asked for the new template and will apply it today.")).toBeVisible();
    await expectSequence(body, "Assigned Handler", "T", "Tolu Technician");
    await expect(body.getByRole("button", { name: "Mark as Resolved" })).toHaveCount(0);
    await expect(body.getByRole("button", { name: "Assign Handler" })).toHaveCount(0);
  });

  test("offers confirm and reopen on a resolved request", async ({ page }) => {
    await page.goto("/support");
    await openTicket(page, TICKETS.resolved);
    await expect(main(page).getByRole("button", { name: "Confirm Resolution" })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Reopen Request" })).toBeVisible();
  });
});

test.describe("support queue for the IT line manager", () => {
  test.use({ role: "itmanager" });

  test("shows the department's requests from every requester", async ({ page }) => {
    await page.goto("/support");
    const body = main(page);
    await body.getByRole("button", { name: /^Department Requests/ }).click();
    for (const title of [TICKETS.open, TICKETS.inProgress, TICKETS.resolved, TICKETS.peer]) {
      await expect(ticketCards(page).filter({ hasText: title })).toHaveCount(1);
    }
    await expect(ticketCards(page).filter({ hasText: TICKETS.hr })).toHaveCount(0);
  });

  test("can assign an unassigned request", async ({ page }) => {
    await page.goto("/support");
    await main(page).getByRole("button", { name: /^Department Requests/ }).click();
    await openTicket(page, TICKETS.open);
    await expect(main(page).getByText("Assign this request to a member of the IT department.")).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Assign Handler" })).toBeDisabled();
  });
});

test.describe("support queue for someone who manages no department", () => {
  test.use({ role: "manager" });

  test("is empty and offers to create a request", async ({ page }) => {
    await page.goto("/support");
    await expect(main(page).getByRole("heading", { name: "No support requests found" })).toBeVisible();
    await expect(main(page).getByText("You have not submitted any support requests yet.")).toBeVisible();
  });
});

test.describe("handling a support request from start to finish", () => {
  test.use({ role: "clerk" });

  test("requires a title and a description", async ({ page }) => {
    await page.goto("/support");
    await main(page).getByRole("button", { name: "New Request" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New Support Request" });
    await dialog.getByRole("button", { name: "Submit Request" }).click();
    await expect(dialog).toBeVisible();
    await expect(ticketCards(page).filter({ hasText: /^$/ })).toHaveCount(0);
  });

  test("routes a general request to Human Resources", async ({ page }) => {
    const title = unique("Payslip address change");
    await submitRequest(page, title, { category: "Other", priority: "Low" });
    await page.goto("/support");
    const card = ticketCards(page).filter({ hasText: title });
    await expect(card).toContainText("General");
    await expect(card).toContainText("Human Resources");
    await expect(card).toContainText("Open");
    await expect(card).toContainText("Low");
  });

  test("is assigned, worked, resolved and confirmed", async ({ page, browser }) => {
    const title = unique("Keyboard keys sticking");
    await submitRequest(page, title, { priority: "High" });
    await page.goto("/support");
    await expect(ticketCards(page).filter({ hasText: title })).toContainText("IT");

    // The IT line manager assigns it to a technician.
    const manager = await pageAs(browser, "itmanager");
    await manager.goto("/support");
    await manager.getByRole("main").getByRole("button", { name: /^Department Requests/ }).click();
    await openTicket(manager, title);
    await choose(manager, main(manager).getByRole("combobox"), /Tolu Technician|itstaff@e2e\.test/);
    await main(manager).getByRole("button", { name: "Assign Handler" }).click();
    await expectSequence(main(manager), "Assigned Handler", "T", "Tolu Technician");
    await expect(main(manager).getByText(/Assigned to Tolu Technician\./)).toBeVisible();
    await manager.context().close();

    // The technician replies, starts work and resolves it.
    const technician = await pageAs(browser, "itstaff");
    await technician.goto("/support");
    await openTicket(technician, title);
    await main(technician).getByRole("textbox", { name: "Type your reply or status update..." }).fill("Swapping the keyboard now.");
    await main(technician).getByRole("button", { name: "Send Reply" }).click();
    await expect(main(technician).getByText("Swapping the keyboard now.")).toBeVisible();
    await main(technician).getByRole("button", { name: /Start|In Progress/ }).first().click();
    await expect(main(technician).getByRole("button", { name: "Mark as Resolved" })).toBeVisible();
    await main(technician).getByRole("button", { name: "Mark as Resolved" }).click();
    await expect(main(technician).getByText("Request marked as resolved.")).toBeVisible();
    await technician.context().close();

    // The requester sees the reply and confirms.
    await page.goto("/support");
    await openTicket(page, title);
    await expect(main(page).getByText("Swapping the keyboard now.")).toBeVisible();
    await main(page).getByRole("button", { name: "Confirm Resolution" }).click();
    await expect(main(page).getByText("Requester confirmed resolution. Request closed.")).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Confirm Resolution" })).toHaveCount(0);

    await page.goto("/support");
    await expect(ticketCards(page).filter({ hasText: title })).toContainText("Closed");
  });

  test("can be reopened by the requester after it is resolved", async ({ page, browser }) => {
    const title = unique("Screen resolution wrong");
    await submitRequest(page, title);

    const manager = await pageAs(browser, "itmanager");
    await manager.goto("/support");
    await manager.getByRole("main").getByRole("button", { name: /^Department Requests/ }).click();
    await openTicket(manager, title);
    await choose(manager, main(manager).getByRole("combobox"), /Tolu Technician|itstaff@e2e\.test/);
    await main(manager).getByRole("button", { name: "Assign Handler" }).click();
    await expectSequence(main(manager), "Assigned Handler", "T", "Tolu Technician");
    await manager.context().close();

    const technician = await pageAs(browser, "itstaff");
    await technician.goto("/support");
    await openTicket(technician, title);
    await main(technician).getByRole("button", { name: /Start|In Progress/ }).first().click();
    await main(technician).getByRole("button", { name: "Mark as Resolved" }).click();
    await expect(main(technician).getByText("Request marked as resolved.")).toBeVisible();
    await technician.context().close();

    await page.goto("/support");
    await openTicket(page, title);
    await main(page).getByRole("button", { name: "Reopen Request" }).click();
    await expect(main(page).getByText("Requester reopened this request.")).toBeVisible();
    await expectSequence(main(page), "Assigned Handler", "Unassigned");
  });
});
