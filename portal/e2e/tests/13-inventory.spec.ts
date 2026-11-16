import type { Page } from "@playwright/test";

import { INVENTORY } from "../support/seed";
import { expect, pageAs, test } from "../support/fixtures";
import { choose, expectSequence, main, unique } from "../support/ui";

function itemRow(page: Page, name: string) {
  return main(page).getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
}

async function openItem(page: Page, name: string) {
  await page.goto("/inventory");
  await main(page).getByRole("textbox", { name: /Search by asset code/ }).fill(name);
  await itemRow(page, name).getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/[0-9a-f-]{36}$/);
  await expect(main(page).getByRole("heading", { level: 1 })).toContainText(name);
}

async function createItem(page: Page, name: string, serial: string) {
  await page.goto("/inventory");
  await main(page).getByRole("button", { name: "Add Asset" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Item" });
  await dialog.getByRole("textbox", { name: "Item Name" }).fill(name);
  await choose(page, dialog.getByRole("combobox", { name: "Category" }), "Laptops");
  await dialog.getByRole("textbox", { name: "Serial Number" }).fill(serial);
  await dialog.getByRole("button", { name: "Create Item" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("my assets for a staff member", () => {
  test.use({ role: "staff" });

  test("lists the equipment assigned to them with who assigned it", async ({ page }) => {
    await page.goto("/my-assets");
    const body = main(page);
    await expectSequence(body, "Total Assigned Assets", 1);
    await expectSequence(body, "Equipment Categories", 1);
    await expect(body.getByRole("heading", { level: 2 })).toHaveText([INVENTORY.assignedToStaff.name]);
    await expect(body.getByText(INVENTORY.assignedToStaff.code)).toBeVisible();
    await expect(body.getByText("DL-5440-001")).toBeVisible();
    await expect(body.getByText("Ife Itmanager")).toBeVisible();
    await expect(body.getByText("New in box")).toBeVisible();
    await expect(body.getByText(INVENTORY.assignedToPeer.name)).toHaveCount(0);
  });
});

test.describe("inventory for an executive (read-only)", () => {
  test.use({ role: "director" });

  test("shows asset totals by state", async ({ page }) => {
    await page.goto("/inventory");
    const body = main(page);
    await expectSequence(body, "Total Assets", 6);
    await expectSequence(body, "Available", 1, "ready to assign");
    await expectSequence(body, "Assigned", 3, "in active use");
    await expectSequence(body, "Maintenance", 1, "under repair");
    await expectSequence(body, "Retired", 1, "decommissioned");
    await expectSequence(body, "Unaccounted", 0, "needs audit");
    await expect(body.getByText(/Showing 6 assets\b/)).toBeVisible();
  });

  test("lists each asset with code, category, status and holder", async ({ page }) => {
    await page.goto("/inventory");
    const assigned = itemRow(page, INVENTORY.assignedToStaff.name);
    await expect(assigned).toContainText(INVENTORY.assignedToStaff.code);
    await expect(assigned).toContainText("Laptops");
    await expect(assigned).toContainText("Assigned");
    await expect(assigned).toContainText("Stan Staff");
    await expect(itemRow(page, INVENTORY.available.name)).toContainText("Available");
    await expect(itemRow(page, INVENTORY.assignedToOps.name)).toContainText("Operations");
    await expect(itemRow(page, INVENTORY.inMaintenance.name)).toContainText("Maintenance");
    await expect(itemRow(page, INVENTORY.retired.name)).toContainText("Retired");
  });

  test("offers no way to add or edit assets", async ({ page }) => {
    await page.goto("/inventory");
    const body = main(page);
    await expect(body.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(body.getByRole("button", { name: "Add Asset" })).toHaveCount(0);
    await expect(body.getByRole("button", { name: "Add Category" })).toHaveCount(0);
    await expect(body.getByRole("button", { name: "Edit item" })).toHaveCount(0);
  });

  test("filters by category and by search text", async ({ page }) => {
    await page.goto("/inventory");
    const body = main(page);
    await body.getByRole("button", { name: "Furniture", exact: true }).click();
    await expect(body.getByText(/Showing 2 assets\b/)).toBeVisible();
    await expect(itemRow(page, INVENTORY.assignedToOps.name)).toHaveCount(1);
    await expect(itemRow(page, INVENTORY.available.name)).toHaveCount(0);

    await body.getByRole("button", { name: "All", exact: true }).click();
    await body.getByRole("textbox", { name: /Search by asset code/ }).fill("100002");
    await expect(body.getByText(/Showing 1 asset\b/)).toBeVisible();
    await expect(itemRow(page, INVENTORY.available.name)).toHaveCount(1);
  });

  test("shows an asset's details and assignment history", async ({ page }) => {
    await openItem(page, INVENTORY.assignedToStaff.name);
    const body = main(page);
    await expect(body.getByRole("heading", { level: 1 })).toHaveText("Dell Latitude 5440 (100001)");
    await expectSequence(body, "Serial Number", "DL-5440-001");
    await expectSequence(body, "Current Assignee", "Stan Staff");
    await expect(body.getByText("Assigned to Stan Staff")).toBeVisible();
    await expect(body.getByRole("button", { name: "Return Item" })).toHaveCount(0);
  });

  test("lists maintenance logs", async ({ page }) => {
    await page.goto("/inventory/maintenance");
    const row = main(page).getByRole("row").filter({ hasText: "Battery drains within an hour" });
    await expect(row).toContainText("Lenovo ThinkPad T14 (100004)");
    await expect(row).toContainText("Tolu Technician");
    await expect(row).toContainText("open");
    await expect(main(page).getByRole("button", { name: "Add Log" })).toHaveCount(0);
  });
});

test.describe("inventory for IT staff", () => {
  test.use({ role: "itstaff" });

  test("can add assets and categories", async ({ page }) => {
    await page.goto("/inventory");
    await expect(main(page).getByRole("button", { name: "Add Asset" })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Add Category" })).toBeVisible();
  });
});

test.describe("managing inventory as the IT line manager", () => {
  test.use({ role: "itmanager" });

  test("adds a category", async ({ page }) => {
    const name = unique("Monitors");
    await page.goto("/inventory");
    await main(page).getByRole("button", { name: "Add Category" }).click();
    const dialog = page.getByRole("dialog", { name: "Create Category" });
    await dialog.getByRole("textbox", { name: "Name" }).fill(name);
    await dialog.getByRole("button", { name: "Create Category" }).click();
    await expect(dialog).toBeHidden();
    await expect(main(page).getByRole("button", { name, exact: true })).toBeVisible();
  });

  test("requires a name and a category for a new asset", async ({ page }) => {
    await page.goto("/inventory");
    await main(page).getByRole("button", { name: "Add Asset" }).click();
    const dialog = page.getByRole("dialog", { name: "Create Item" });
    await dialog.getByRole("button", { name: "Create Item" }).click();
    await expect(dialog).toBeVisible();
  });

  test("adds an asset, which starts out available with a six-digit code", async ({ page }) => {
    const name = unique("Surface Laptop");
    await createItem(page, name, "SL-" + Date.now());
    await main(page).getByRole("textbox", { name: /Search by asset code/ }).fill(name);
    const row = itemRow(page, name);
    await expect(row).toContainText("Available");
    await expect(row.getByRole("cell").first()).toHaveText(/^\d{6}$/);
  });

  test("assigns an asset from its own page; the person sees it under My Assets", async ({ page, browser }) => {
    const name = unique("Spare Charger");
    await createItem(page, name, "SC-" + Date.now());
    await openItem(page, name);
    const body = main(page);

    await body.getByRole("button", { name: "Assign Item" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign Item" });
    await choose(page, dialog.getByRole("combobox"), /Chidi Clerk/, "clerk");
    await dialog.getByRole("textbox", { name: "Condition Notes (Optional)" }).fill("Boxed, unused");
    await dialog.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(dialog).toBeHidden();

    await expectSequence(body, "Current Assignee", "Chidi Clerk");
    await expect(body.getByText("Assigned to Chidi Clerk")).toBeVisible();
    await expect(body.getByRole("button", { name: "Return Item" })).toBeVisible();

    const clerk = await pageAs(browser, "clerk");
    await clerk.goto("/my-assets");
    await expect(clerk.getByRole("main").getByRole("heading", { level: 2, name })).toBeVisible();
    await expect(clerk.getByRole("main").getByText("Boxed, unused")).toBeVisible();
    await clerk.context().close();
  });

  test("does not offer deactivated people when assigning from the asset page", async ({ page }) => {
    await openItem(page, INVENTORY.available.name);
    await main(page).getByRole("button", { name: "Assign Item" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign Item" });
    await dialog.getByRole("combobox").click();
    await page.keyboard.type("fola");
    await expect(page.getByText("No user found.")).toBeVisible();
    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("logging a fault puts the asset into maintenance", async ({ page }) => {
    const name = unique("Dock Station");
    await createItem(page, name, "DK-" + Date.now());
    await openItem(page, name);
    const body = main(page);

    await body.getByRole("button", { name: "Add Log" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: /Issue/ }).fill("Ports not detected");
    await dialog.getByRole("button", { name: /Save|Create|Add/ }).last().click();
    await expect(dialog).toBeHidden();
    await expect(body.getByText("Ports not detected")).toBeVisible();
    await expect(body.getByText("MAINTENANCE")).toBeVisible();

    await page.goto("/inventory/maintenance");
    await expect(main(page).getByRole("row").filter({ hasText: "Ports not detected" })).toContainText(name);
  });
});

test.describe("assigning inventory", () => {
  test.use({ role: "itmanager" });

  test("assigns an asset from the list's edit dialog; the person then sees it under My Assets; and takes it back", async ({ page, browser }) => {
    const name = unique("ThinkPad X1");
    await createItem(page, name, "X1-" + Date.now());
    await main(page).getByRole("textbox", { name: /Search by asset code/ }).fill(name);

    await itemRow(page, name).getByRole("button", { name: "Edit item" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Inventory Item" });
    await choose(page, dialog.getByRole("combobox").last(), /Chidi Clerk/, "clerk");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(itemRow(page, name)).toContainText("Assigned");
    await expect(itemRow(page, name)).toContainText("Chidi Clerk");

    const clerk = await pageAs(browser, "clerk");
    await clerk.goto("/my-assets");
    await expect(clerk.getByRole("main").getByRole("heading", { level: 2, name })).toBeVisible();

    await openItem(page, name);
    const body = main(page);
    await expectSequence(body, "Current Assignee", "Chidi Clerk");
    await expect(body.getByText("Assigned to Chidi Clerk")).toBeVisible();
    await body.getByRole("button", { name: "Return Item" }).click();
    const returning = page.getByRole("dialog", { name: /Return/ });
    await returning.getByRole("button", { name: /Return|Confirm/ }).last().click();
    await expect(returning).toBeHidden();
    await expectSequence(body, "Current Assignee", "None");
    await expect(body.getByRole("button", { name: "Assign Item" })).toBeVisible();

    await clerk.reload();
    await expect(clerk.getByRole("main").getByRole("heading", { level: 2, name })).toHaveCount(0);
    await clerk.context().close();
  });
});

test.describe("assigning inventory from the asset page as an administrator", () => {
  test.use({ role: "admin" });

  test("assigns the asset to the chosen person", async ({ page }) => {
    const name = unique("Loan Laptop");
    await createItem(page, name, "LL-" + Date.now());
    await openItem(page, name);
    await main(page).getByRole("button", { name: "Assign Item" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign Item" });
    await choose(page, dialog.getByRole("combobox"), /Chidi Clerk/, "clerk");
    await dialog.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectSequence(main(page), "Current Assignee", "Chidi Clerk");

    await page.goto("/inventory");
    await main(page).getByRole("textbox", { name: /Search by asset code/ }).fill(name);
    await expect(itemRow(page, name)).toContainText("Assigned");
    await expect(itemRow(page, name)).toContainText("Chidi Clerk");
  });
});
