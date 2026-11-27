import type { Locator, Page } from "@playwright/test";

import { REQUEST_CLIENTS, USERS } from "../support/seed";
import { expect, pageAs, test } from "../support/fixtures";
import { expectToast, main } from "../support/ui";

/** A PNR no other request has: 6 capital letters and digits. */
function uniquePnr(): string {
  return `${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`.toUpperCase();
}

// The e2e stack has no object storage (its endpoint is 127.0.0.1:9). Stand in
// for it, so the payment evidence upload succeeds.
async function fakeStorage(page: Page) {
  await page.route("http://127.0.0.1:9/**", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, PUT",
        "Access-Control-Allow-Headers": "*",
      },
    }),
  );
}

const PDF = { name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e receipt") };

function field(scope: Locator, label: string | RegExp) {
  return scope.getByLabel(typeof label === "string" ? new RegExp(`^${label}`) : label);
}

type Ticket = {
  passenger?: string;
  pnr: string;
  selling: string;
  cost: string;
  route?: string;
};

async function fillTicket(page: Page, ticket: Ticket) {
  const body = main(page);
  await body.getByRole("textbox", { name: "Passenger 1" }).fill(ticket.passenger ?? "OKAFOR/NGOZI MRS");
  await field(body, /^Airline \*/).fill("AIR PEACE");
  await field(body, "PNR").fill(ticket.pnr);
  await field(body, "Departure date").fill("2026-12-20");
  await field(body, "Route").fill(ticket.route ?? "los-abv");
  await field(body, "Vendor").fill("INCEL/KIU");
  await field(body, "Selling price").fill(ticket.selling);
  await field(body, "Cost price").fill(ticket.cost);
}

async function startCash(page: Page) {
  await page.goto("/service-requests/requests/new");
  await main(page).getByRole("button", { name: /^Cash/ }).click();
  await expect(main(page).getByRole("heading", { level: 1, name: "Ticket details" })).toBeVisible();
}

async function startCredit(page: Page, clientName: string) {
  await page.goto("/service-requests/requests/new");
  await main(page).getByRole("button", { name: /^Credit/ }).click();
  await main(page).getByRole("textbox", { name: "Search credit clients" }).fill(clientName);
  await main(page).getByRole("button", { name: new RegExp(`^${clientName}`) }).click();
  await expect(main(page).getByRole("heading", { level: 1, name: "Ticket details" })).toBeVisible();
}

async function submitCash(page: Page, ticket: Ticket) {
  await fakeStorage(page);
  await startCash(page);
  await field(main(page), "Client name").fill("AFRIWINGS");
  await fillTicket(page, ticket);
  await field(main(page), "Amount received").fill(ticket.selling);
  await page.locator("#ticket-evidence").setInputFiles(PDF);
  await expect(main(page).getByText("receipt.pdf")).toBeVisible();
  await main(page).getByRole("button", { name: "Submit request" }).click();
  await expect(page).toHaveURL(/\/service-requests\/requests\/[0-9a-f-]{36}$/);
}

/** Submits an over-limit credit request and returns its page's URL. */
async function submitOverLimit(page: Page, pnr: string) {
  await startCredit(page, REQUEST_CLIENTS.tight.name);
  await fillTicket(page, { pnr, selling: "150000", cost: "140000" });
  await expect(main(page).getByText(/will need approval before the ticket is issued/)).toBeVisible();
  await main(page).getByRole("button", { name: "Submit for approval" }).click();
  await expect(page).toHaveURL(/\/service-requests\/requests\/[0-9a-f-]{36}$/);
  await expect(main(page).getByText("Pending first approval")).toBeVisible();
  return page.url();
}

test.describe("service requests for a submitter", () => {
  test.use({ role: "peer" });

  test("shows the Requests and Clients parts, without Approvals", async ({ page }) => {
    await page.goto("/service-requests");
    await expect(page).toHaveURL("/service-requests/requests");
    const nav = main(page).getByRole("navigation", { name: "Service Requests" });
    await expect(nav.getByRole("link")).toHaveText(["Requests", "Clients"]);
    await page.goto("/service-requests/approvals");
    await expect(page).not.toHaveURL(/approvals/);
  });

  test("checks the form before it can be submitted", async ({ page }) => {
    await startCash(page);
    await main(page).getByRole("button", { name: "Submit request" }).click();
    const body = main(page);
    await expect(body.getByText("Some fields need attention. They are marked in red.")).toBeVisible();
    await expect(body.getByText("Client name is required.")).toBeVisible();
    await expect(body.getByText("Add at least one passenger.")).toBeVisible();
    await expect(body.getByText("Attach the payment evidence (an image or a PDF).")).toBeVisible();

    await field(body, "Client name").fill("AFRIWINGS");
    await fillTicket(page, { pnr: "AB", selling: "100000", cost: "120000", route: "LOS ABV" });
    await field(body, "Amount received").fill("90000");
    await expect(body.getByText("The selling price is below the cost price.")).toBeVisible();
    await expect(body.getByText("Less than the selling price.")).toBeVisible();
    await body.getByRole("button", { name: "Submit request" }).click();
    await expect(body.getByText("PNR must be 5 to 8 letters and numbers, e.g. AB3ZKB.")).toBeVisible();
    await expect(body.getByText(/Route must be airport codes separated by hyphens/)).toBeVisible();
    await expect(body.getByText(/Selling price is below the cost price: revenue would be/)).toBeVisible();
    await expect(body.getByText(/Cash requests must be paid in full/)).toBeVisible();
  });

  test("submits a cash ticket, then marks it completed", async ({ page }) => {
    const pnr = uniquePnr();
    await submitCash(page, { pnr, selling: "149300", cost: "146300", passenger: "STELLA CHIZENA ENOCK" });
    const body = main(page);
    await expect(body.getByRole("heading", { level: 1 })).toHaveText(
      "[TICKET] Client: [AFRIWINGS_STELLA CHIZENA ENOCK | Amount: ₦149,300]",
    );
    await expect(body.getByText(/^TKT-\d{4}-\d{5}$/)).toBeVisible();
    await expect(body.getByText("Submitted", { exact: true })).toBeVisible();
    await expect(body.getByText("₦3,000.00")).toBeVisible();
    await expect(body.getByText(pnr)).toBeVisible();
    await expect(body.getByRole("button", { name: "receipt.pdf" })).toBeVisible();
    await expect(body.getByText(`${USERS.peer.name} submitted the request`)).toBeVisible();

    await body.getByRole("button", { name: "Mark completed" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark completed" }).click();
    await expectToast(page, "Request marked completed.");
    await expect(body.getByText("Completed", { exact: true })).toBeVisible();
    await expect(body.getByRole("button", { name: "Cancel request" })).toHaveCount(0);
  });

  test("refuses a PNR that is already on a live request", async ({ page }) => {
    const pnr = uniquePnr();
    await submitCash(page, { pnr, selling: "50000", cost: "45000" });
    await startCash(page);
    await field(main(page), "Client name").fill("AFRIWINGS");
    await fillTicket(page, { pnr, selling: "50000", cost: "45000" });
    await field(main(page), "Amount received").fill("50000");
    await page.locator("#ticket-evidence").setInputFiles(PDF);
    await main(page).getByRole("button", { name: "Submit request" }).click();
    await expect(main(page).getByText("Another request already uses this PNR.")).toBeVisible();
  });

  test("asks to confirm a request with no profit", async ({ page }) => {
    await fakeStorage(page);
    await startCash(page);
    await field(main(page), "Client name").fill("AFRIWINGS");
    await fillTicket(page, { pnr: uniquePnr(), selling: "60000", cost: "60000" });
    await field(main(page), "Amount received").fill("60000");
    await page.locator("#ticket-evidence").setInputFiles(PDF);
    await expect(main(page).getByText(/No profit on this transaction: you will be asked to confirm/)).toBeVisible();
    await main(page).getByRole("button", { name: "Submit request" }).click();
    const dialog = page.getByRole("dialog", { name: "No profit on this transaction" });
    await dialog.getByRole("button", { name: "Submit anyway" }).click();
    await expect(page).toHaveURL(/\/service-requests\/requests\/[0-9a-f-]{36}$/);
  });

  test("works out the cost from the discount for an affiliate", async ({ page }) => {
    await startCash(page);
    const body = main(page);
    await body.getByText("Affiliate", { exact: true }).click();
    await expect(body.getByText("Affiliate tickets need the full discount section.")).toBeVisible();
    await field(body, "Published fare").fill("1000000");
    await field(body, "Net commission").fill("200000");
    await field(body, "Commission given to the customer").fill("50000");
    await expect(body.getByText("₦150,000.00").first()).toBeVisible(); // balance commission
    await expect(body.getByText("₦950,000.00").first()).toBeVisible(); // cost price, locked
    await expect(body.getByRole("textbox", { name: /^Cost price/ })).toHaveCount(0);
  });

  test("puts a credit ticket on the client's balance, and gives it back on cancelling", async ({ page }) => {
    await startCredit(page, REQUEST_CLIENTS.roomy.name);
    await fillTicket(page, { pnr: uniquePnr(), selling: "250000", cost: "240000" });
    const body = main(page);
    await expect(body.getByText("Credit status")).toBeVisible();
    await expect(body.getByRole("button", { name: "Submit request" })).toBeVisible();
    await body.getByRole("button", { name: "Submit request" }).click();
    await expect(page).toHaveURL(/\/service-requests\/requests\/[0-9a-f-]{36}$/);
    await expect(body.getByText("Credit status when submitted")).toBeVisible();
    await expect(body.getByText("Submitted", { exact: true })).toBeVisible();
    const reference = (await body.getByText(/^TKT-\d{4}-\d{5}$/).textContent()) ?? "";

    await body.getByRole("button", { name: "Cancel request" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this request" });
    await expect(dialog.getByText(/the amount goes back to the client's balance/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel request" }).click();
    await expect(dialog.getByText("Give a reason.")).toBeVisible();
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Client changed the date");
    await dialog.getByRole("button", { name: "Cancel request" }).click();
    await expect(body.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(body.getByText("Client changed the date").first()).toBeVisible();

    await body.getByRole("link", { name: "Open the client" }).click();
    await expect(main(page).getByText(`changed its balance: ${reference} cancelled`)).toBeVisible();
    await expect(main(page).getByText(`changed its balance: ${reference} submitted`)).toBeVisible();
  });
});

test.describe("over-limit credit requests", () => {
  test.use({ role: "peer" });

  test("need a first approval and then the ED's", async ({ page, browser }) => {
    const url = await submitOverLimit(page, uniquePnr());

    // A viewer sees it but cannot approve.
    const viewer = await pageAs(browser, "staff");
    await viewer.goto(url);
    await expect(main(viewer).getByText("Waiting for the first approval")).toBeVisible();
    await expect(main(viewer).getByRole("button", { name: /approval/ })).toHaveCount(0);
    await viewer.context().close();

    // The Logistics supervisor finds it under Approvals and gives the first approval.
    const supervisor = await pageAs(browser, "supervisor");
    await supervisor.goto("/service-requests/approvals");
    const nav = main(supervisor).getByRole("navigation", { name: "Service Requests" });
    await expect(nav.getByRole("link", { name: /Approvals/ })).toContainText(/\d/);
    await supervisor.goto(url);
    await main(supervisor).getByRole("button", { name: "Give first approval" }).click();
    await expect(main(supervisor).getByText("Waiting for the ED's final approval")).toBeVisible();
    await expect(main(supervisor).getByRole("button", { name: /approval/ })).toHaveCount(0);
    await supervisor.context().close();

    // The ED gives the final approval.
    const director = await pageAs(browser, "director");
    await director.goto(url);
    await main(director).getByRole("button", { name: "Give final approval" }).click();
    await expect(main(director).getByText("Approved", { exact: true }).first()).toBeVisible();
    await director.context().close();

    // The submitter issues the ticket.
    await page.reload();
    await expect(main(page).getByText(`${USERS.director.name} gave the final approval`)).toBeVisible();
    await main(page).getByRole("button", { name: "Mark completed" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark completed" }).click();
    await expect(main(page).getByText("Completed", { exact: true })).toBeVisible();
  });

  test("can be rejected, then started again from the rejected one", async ({ page, browser }) => {
    const pnr = uniquePnr();
    const url = await submitOverLimit(page, pnr);

    const manager = await pageAs(browser, "manager");
    await manager.goto(url);
    await main(manager).getByRole("button", { name: "Reject" }).click();
    const dialog = manager.getByRole("dialog", { name: "Reject this request" });
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Client has unpaid invoices");
    await dialog.getByRole("button", { name: "Reject request" }).click();
    await expect(main(manager).getByText("Rejected", { exact: true }).first()).toBeVisible();
    await manager.context().close();

    await page.reload();
    await expect(main(page).getByText("Client has unpaid invoices").first()).toBeVisible();
    await main(page).getByRole("link", { name: "New request from this one" }).click();
    await expect(main(page).getByText("Copied from an earlier request. Change what was wrong and submit.")).toBeVisible();
    await expect(field(main(page), "PNR")).toHaveValue(pnr);
    await expect(main(page).getByText(REQUEST_CLIENTS.tight.name).first()).toBeVisible();
    await main(page).getByRole("button", { name: "Submit for approval" }).click();
    await expect(main(page).getByText("Pending first approval")).toBeVisible();
  });
});

test.describe("approving your own request", () => {
  test.use({ role: "supervisor" });

  test("is not offered", async ({ page }) => {
    await submitOverLimit(page, uniquePnr());
    await expect(main(page).getByRole("button", { name: "Give first approval" })).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: "Cancel request" })).toBeVisible();
  });
});

test.describe("service requests for an executive", () => {
  test.use({ role: "director" });

  test("shows every part and cannot submit", async ({ page }) => {
    await page.goto("/service-requests/requests");
    const nav = main(page).getByRole("navigation", { name: "Service Requests" });
    await expect(nav.getByRole("link")).toHaveText([/^Requests/, /^Approvals/, /^Clients/]);
    await expect(main(page).getByRole("link", { name: "New request" })).toHaveCount(0);
    await page.goto("/service-requests/requests/new");
    await expect(page).toHaveURL("/service-requests/requests");
  });
});
