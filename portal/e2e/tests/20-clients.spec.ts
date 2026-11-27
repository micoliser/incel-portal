import type { Locator, Page } from "@playwright/test";

import { CLIENTS, USERS } from "../support/seed";
import { expect, test } from "../support/fixtures";
import { choose, expectToast, main, sidebar, unique } from "../support/ui";

// Every seeded client's TIN starts with this; clients the tests add use other TINs,
// so searching for it lists exactly the seeded three however often the suite runs.
const SEEDED_TIN_PREFIX = "1000000";

let tinSequence = 0;

/** A TIN no other client has: 10 digits from the clock and a 2-digit counter. */
function uniqueTin(): string {
  tinSequence += 1;
  return `${Date.now().toString().slice(-10)}${String(tinSequence % 100).padStart(2, "0")}`;
}

function clientRow(page: Page, name: string): Locator {
  return main(page).getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
}

async function search(page: Page, text: string) {
  await main(page).getByRole("textbox", { name: "Search clients" }).fill(text);
}

async function openClient(page: Page, name: string) {
  await page.goto("/service-requests/clients");
  await search(page, name);
  await clientRow(page, name).getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(/\/service-requests\/clients\/[0-9a-f-]{36}$/);
  await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(name);
}

function clientDialog(page: Page): Locator {
  return page.getByRole("dialog");
}

function field(dialog: Locator, label: string): Locator {
  return dialog.getByRole("textbox", { name: new RegExp(`^${label}`) });
}

async function fillContact(dialog: Locator) {
  await field(dialog, "Contact person").fill("Ngozi Eze");
  await field(dialog, "Phone").fill("+234 803 555 0101");
  await field(dialog, "Email").fill("ngozi@example.com");
}

const CONTACT_HEADERS = ["Contact Person", "Phone", "Email"];
const CONTACT_VALUES = ["Ada Obi", "+234 803 123 4567", "ada@example.com"];

/**
 * A spreadsheet as the import page receives it: a CSV file built from rows.
 * Contact person, phone and email are required, so they are added unless the
 * header already has an Email column or `contacts` is false.
 */
function csv(name: string, rows: Array<Array<string | number>>, contacts = true) {
  const withContacts =
    contacts && rows.length && !rows[0].some((cell) => String(cell).trim().toLowerCase() === "email")
      ? [[...rows[0], ...CONTACT_HEADERS], ...rows.slice(1).map((row) => [...row, ...CONTACT_VALUES])]
      : rows;
  const text = withContacts
    .map((row) => row.map((cell) => (/[",\n]/.test(String(cell)) ? `"${String(cell).replace(/"/g, '""')}"` : cell)).join(","))
    .join("\n");
  return { name, mimeType: "text/csv", buffer: Buffer.from(`${text}\n`, "utf-8") };
}

async function chooseFile(page: Page, file: ReturnType<typeof csv>) {
  await page.locator("#client-import-file").setInputFiles(file);
}

test.describe("credit clients for a viewer", () => {
  test.use({ role: "staff" });

  test("lists clients with their limits, utilization and available balance", async ({ page }) => {
    await page.goto("/service-requests/clients");
    await search(page, SEEDED_TIN_PREFIX);
    const body = main(page);
    await expect(body.getByText("3 clients match")).toBeVisible();
    await expect(body.getByRole("row").filter({ has: page.getByRole("link") })).toHaveCount(3);

    const harbour = clientRow(page, CLIENTS.active.name);
    await expect(harbour).toContainText(CLIENTS.active.tin);
    await expect(harbour).toContainText("₦5,000,000.00");
    await expect(harbour).toContainText("₦1,250,000.00");
    await expect(harbour).toContainText("₦3,750,000.00");
    await expect(harbour).toContainText("Active");

    // Utilization above the limit gives a negative balance.
    await expect(clientRow(page, CLIENTS.overLimit.name)).toContainText("-US$5,000.00");
    await expect(clientRow(page, CLIENTS.inactive.name)).toContainText("Inactive");
  });

  test("cannot add, edit or import", async ({ page }) => {
    await page.goto("/service-requests/clients");
    await expect(clientRow(page, CLIENTS.active.name)).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Add client" })).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: "Import spreadsheet" })).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: /^Edit / })).toHaveCount(0);

    await page.goto("/service-requests/clients/import");
    await expect(page).toHaveURL("/service-requests/clients");
  });

  test("searches and filters", async ({ page }) => {
    await page.goto("/service-requests/clients");
    await search(page, "harbour");
    await expect(main(page).getByText("1 client match")).toBeVisible();
    await expect(clientRow(page, CLIENTS.active.name)).toBeVisible();

    await search(page, SEEDED_TIN_PREFIX);
    await choose(page, main(page).getByRole("combobox", { name: "Filter by status" }), "Inactive");
    await expect(main(page).getByText("1 client match")).toBeVisible();
    await expect(clientRow(page, CLIENTS.inactive.name)).toBeVisible();

    await choose(page, main(page).getByRole("combobox", { name: "Filter by status" }), "All statuses");
    await choose(page, main(page).getByRole("combobox", { name: "Filter by currency" }), "USD");
    await expect(main(page).getByText("1 client match")).toBeVisible();
    await expect(clientRow(page, CLIENTS.overLimit.name)).toBeVisible();

    await main(page).getByRole("button", { name: "Reset" }).click();
    await search(page, "no client is called this");
    await expect(main(page).getByText("No clients match")).toBeVisible();
  });

  test("opens a client with its balance and history", async ({ page }) => {
    await openClient(page, CLIENTS.overLimit.name);
    const body = main(page);
    await expect(body.getByText(`TIN ${CLIENTS.overLimit.tin}`)).toBeVisible();
    await expect(body.getByText("Over the limit: new requests will need approval.")).toBeVisible();
    await expect(body.getByText(`${USERS.warehouse.name} added this client`)).toBeVisible();
    await expect(body.getByRole("button", { name: "Edit client" })).toHaveCount(0);
  });
});

test.describe("credit clients for people without access", () => {
  test.use({ role: "itstaff" });

  test("are not in the menu and send them back to the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(sidebar(page).getByRole("link", { name: "Service Requests", exact: true })).toHaveCount(0);
    for (const path of ["/service-requests", "/service-requests/clients"]) {
      await page.goto(path);
      await expect(page).toHaveURL("/dashboard");
    }
  });
});

test.describe("credit clients for the unit supervisor who manages them", () => {
  test.use({ role: "supervisor" });

  test("can add and import", async ({ page }) => {
    await page.goto("/service-requests/clients");
    await expect(main(page).getByRole("button", { name: "Add client" })).toBeVisible();
    await expect(main(page).getByRole("link", { name: "Import spreadsheet" })).toBeVisible();
  });
});

test.describe("adding and editing credit clients", () => {
  test.use({ role: "warehouse" });

  test("checks the form, then adds a client", async ({ page }) => {
    const name = unique("E2E Client");
    const tin = uniqueTin();
    await page.goto("/service-requests/clients");
    await main(page).getByRole("button", { name: "Add client" }).click();
    const dialog = clientDialog(page);
    await expect(dialog.getByRole("heading", { name: "Add credit client" })).toBeVisible();

    // Required fields are checked before anything is sent.
    await dialog.getByRole("button", { name: "Add client" }).click();
    await expect(dialog.getByText("Name is required.")).toBeVisible();
    await expect(dialog.getByText("TIN is required.")).toBeVisible();
    await expect(dialog.getByText("Contact person is required.")).toBeVisible();
    await expect(dialog.getByText("Phone is required.")).toBeVisible();
    await expect(dialog.getByText("Email is required.")).toBeVisible();
    await expect(dialog.getByText("Credit limit is required.")).toBeVisible();
    await expect(dialog.getByText("Credit days is required.")).toBeVisible();

    // The server's rules for the rest.
    await field(dialog, "Name").fill(name);
    await field(dialog, "TIN").fill("12AB");
    await field(dialog, "Contact person").fill("Ngozi Eze");
    await field(dialog, "Phone").fill("12");
    await field(dialog, "Email").fill("ngozi@example.com");
    await field(dialog, "Credit limit").fill("2,000,000");
    await field(dialog, "Credit days").fill("45");
    await field(dialog, "Credit utilization").fill("2500000");
    await expect(dialog.getByText("Utilization is above the limit.")).toBeVisible();
    await dialog.getByRole("button", { name: "Add client" }).click();
    await expect(dialog.getByText(/TIN must be 8 to 15 digits/)).toBeVisible();
    await expect(dialog.getByText(/Phone must be a phone number of 7 to 15 digits/)).toBeVisible();

    await field(dialog, "TIN").fill(tin);
    await field(dialog, "Phone").fill("+234 803 555 0101");
    await field(dialog, "Email").fill("Accounts@Example.com");
    await field(dialog, "Credit utilization").fill("500000");
    await choose(page, dialog.getByRole("combobox", { name: "Currency" }), "USD");
    await dialog.getByRole("button", { name: "Add client" }).click();
    await expectToast(page, "Client added.");
    await expect(dialog).toBeHidden();

    await search(page, name);
    const row = clientRow(page, name);
    await expect(row).toContainText(tin);
    await expect(row).toContainText("US$2,000,000.00");
    await expect(row).toContainText("US$1,500,000.00");

    await openClient(page, name);
    await expect(main(page).getByText("accounts@example.com")).toBeVisible();
  });

  test("refuses a TIN another client has", async ({ page }) => {
    await page.goto("/service-requests/clients");
    await main(page).getByRole("button", { name: "Add client" }).click();
    const dialog = clientDialog(page);
    await field(dialog, "Name").fill(unique("E2E Duplicate"));
    await field(dialog, "TIN").fill(CLIENTS.active.tin);
    await fillContact(dialog);
    await field(dialog, "Credit limit").fill("1000");
    await field(dialog, "Credit days").fill("7");
    await dialog.getByRole("button", { name: "Add client" }).click();
    await expect(dialog.getByText("A client with this TIN already exists.")).toBeVisible();
  });

  test("records who changed the limit, from what to what", async ({ page }) => {
    const name = unique("E2E Edited");
    await page.goto("/service-requests/clients");
    await main(page).getByRole("button", { name: "Add client" }).click();
    let dialog = clientDialog(page);
    await field(dialog, "Name").fill(name);
    await field(dialog, "TIN").fill(uniqueTin());
    await fillContact(dialog);
    await field(dialog, "Credit limit").fill("100000");
    await field(dialog, "Credit days").fill("30");
    await dialog.getByRole("button", { name: "Add client" }).click();
    await expect(dialog).toBeHidden();

    await openClient(page, name);
    await main(page).getByRole("button", { name: "Edit client" }).click();
    dialog = clientDialog(page);
    await field(dialog, "Credit limit").fill("250000");
    await choose(page, dialog.getByRole("combobox", { name: "Status" }), "Inactive");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Client updated.");

    const body = main(page);
    await expect(body.getByText("₦250,000.00").first()).toBeVisible();
    const edit = body.getByRole("listitem").filter({ hasText: `${USERS.warehouse.name} edited it` });
    await expect(edit).toContainText("Credit limit: ₦100,000.00 → ₦250,000.00");
    await expect(edit).toContainText("Status: Active → Inactive");
  });
});

test.describe("importing credit clients", () => {
  test.use({ role: "warehouse" });

  test("offers the template", async ({ page }) => {
    await page.goto("/service-requests/clients/import");
    const download = page.waitForEvent("download");
    await main(page).getByRole("button", { name: "Download template" }).click();
    expect((await download).suggestedFilename()).toBe("credit-clients-template.xlsx");
  });

  test("rejects a file with missing columns", async ({ page }) => {
    await page.goto("/service-requests/clients/import");
    await chooseFile(page, csv("missing.csv", [["Name", "Limit"], ["Some Co", 100]], false));
    const alert = main(page).getByRole("alert");
    await expect(alert).toContainText("This file can't be imported yet");
    await expect(alert).toContainText(
      "Required columns are missing: TIN, Contact Person, Phone, Email, Credit Limit, Credit Days.",
    );
    await expect(main(page).getByRole("button", { name: "Confirm import" })).toHaveCount(0);
  });

  test("lists every row error by row and column, and imports nothing", async ({ page }) => {
    const name = unique("E2E Bad Row");
    await page.goto("/service-requests/clients/import");
    await chooseFile(
      page,
      csv("errors.csv", [
        ["Name", "TIN", "Credit Limit", "Credit Days", "Currency"],
        [name, uniqueTin(), 1000, 30, "NGN"],
        ["", "abc", -5, "1.5", "YEN"],
      ]),
    );
    const alert = main(page).getByRole("alert");
    await expect(alert).toContainText("5 problems found.");
    for (const [column, message] of [
      ["Name", "Name is required."],
      ["TIN", "TIN must be 8 to 15 digits"],
      ["Credit Limit", "Credit limit must be more than 0."],
      ["Credit Days", "Credit days must be a whole number of days"],
      ["Currency", "Currency must be one of"],
    ]) {
      await expect(alert.getByRole("row").filter({ hasText: column }).filter({ hasText: message })).toContainText("3");
    }
    await page.goto("/service-requests/clients");
    await search(page, name);
    await expect(main(page).getByText("No clients match")).toBeVisible();
  });

  test("asks to confirm notices, then imports and defaults missing columns", async ({ page }) => {
    const over = unique("E2E Import Over");
    const plain = unique("E2E Import Plain");
    await page.goto("/service-requests/clients/import");
    // Header names differ in case, underscores and hyphens from the template, and
    // there are no Status or Currency columns.
    await chooseFile(
      page,
      csv("first.csv", [
        [" NAME ", "TIN", "credit_limit", "CREDIT-DAYS", "Credit Utilization", "Available Balance", "Region"],
        [over, uniqueTin(), 1000, 30, 1500, 999, "Lagos"],
        [plain, uniqueTin(), "2,500.50", 15, 0, 0, "Abuja"],
      ]),
    );
    const body = main(page);
    await expect(body.getByText("The file passed every check")).toBeVisible();
    await expect(body.getByText("2 clients in the file: 2 new.")).toBeVisible();
    await expect(body.getByText("These columns are not recognised and will not be imported: Region.")).toBeVisible();
    await expect(body.getByText(/There is no Status column\. New clients will get Active/)).toBeVisible();
    await expect(body.getByText(/There is no Currency column\. New clients will get NGN/)).toBeVisible();
    await expect(body.getByText(/The Available Balance column will be ignored/)).toBeVisible();
    await expect(body.getByText(/1 client will start with a negative available balance/)).toBeVisible();

    const confirm = body.getByRole("button", { name: "Confirm import" });
    await expect(confirm).toBeDisabled();
    await body.getByRole("checkbox", { name: "I have read these and want to continue" }).check();
    await expect(body.getByText("2 will be added, 0 updated and 0 rejected.")).toBeVisible();
    await confirm.click();
    await expectToast(page, "Clients imported.");
    await expect(body.getByText("Import complete")).toBeVisible();
    await expect(body.getByText("2 added, 0 updated, 0 rejected from first.csv.")).toBeVisible();
    await expect(body.getByText("Recent imports")).toBeVisible();

    await page.goto("/service-requests/clients");
    await search(page, "E2E Import");
    const overRow = clientRow(page, over);
    await expect(overRow).toContainText("₦1,000.00");
    await expect(overRow).toContainText("-₦500.00");
    await expect(overRow).toContainText("Active");
    await expect(clientRow(page, plain)).toContainText("₦2,500.50");
  });

  test("lets the uploader decide each duplicate", async ({ page }) => {
    const existing = unique("E2E Existing");
    const existingTin = uniqueTin();
    await page.goto("/service-requests/clients/import");
    await chooseFile(page, csv("setup.csv", [["Name", "TIN", "Credit Limit", "Credit Days", "Currency", "Status", "Credit Utilization"], [existing, existingTin, 1000, 30, "NGN", "Active", 100]]));
    await main(page).getByRole("button", { name: "Confirm import" }).click();
    await expect(main(page).getByText("Import complete")).toBeVisible();

    const twin = unique("E2E Twin");
    await main(page).getByRole("button", { name: "Import another file" }).click();
    await chooseFile(
      page,
      csv("duplicates.csv", [
        ["Name", "TIN", "Credit Limit", "Credit Days", "Currency", "Status"],
        [existing.toUpperCase(), uniqueTin(), 9000, 60, "NGN", "Active"], // same name as an existing client
        [twin, uniqueTin(), 100, 1, "NGN", "Active"],
        [twin.toLowerCase(), uniqueTin(), 200, 2, "NGN", "Active"], // same name as row 3
      ]),
    );
    const body = main(page);
    await expect(body.getByText("3 clients in the file: 0 new, 2 duplicates to decide.")).toBeVisible();
    await expect(body.getByText("Same name or TIN: already exists.")).toBeVisible();
    await expect(body.getByText("Same name or TIN: appears more than once in the file.")).toBeVisible();
    await expect(body.getByText("2 duplicates still need a decision.")).toBeVisible();
    await expect(body.getByRole("button", { name: "Confirm import" })).toBeDisabled();

    await body.getByRole("radio", { name: "Update the existing client with row 2" }).check();
    await body.getByRole("radio", { name: "Import row 4" }).check();
    // No Credit Utilization column: a notice to confirm even with every duplicate decided.
    await expect(body.getByText("Tick the box above to confirm the notices.")).toBeVisible();
    await body.getByRole("checkbox", { name: "I have read these and want to continue" }).check();
    await expect(body.getByText("1 will be added, 1 updated and 1 rejected.")).toBeVisible();
    await body.getByRole("button", { name: "Confirm import" }).click();
    await expect(body.getByText("1 added, 1 updated, 1 rejected from duplicates.csv.")).toBeVisible();

    // The existing client took row 2's values but kept its utilization (no such column in the file).
    await openClient(page, existing.toUpperCase());
    await expect(main(page).getByText("₦9,000.00").first()).toBeVisible();
    await expect(main(page).getByText("₦100.00").first()).toBeVisible();
    await expect(main(page).getByText(`${USERS.warehouse.name} updated it from duplicates.csv`)).toBeVisible();

    await page.goto("/service-requests/clients");
    await search(page, twin);
    await expect(main(page).getByText("1 client match")).toBeVisible();
    await expect(clientRow(page, twin.toLowerCase())).toContainText("₦200.00");
  });
});
