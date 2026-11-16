import type { Page } from "@playwright/test";

import { APPS } from "../support/seed";
import { expect, pageAs, test } from "../support/fixtures";
import { choose, expectSequence, expectToast, main, unique } from "../support/ui";

function appTitles(page: Page) {
  return main(page).getByRole("heading", { level: 2 });
}

/** The card for one application: the smallest block holding its title and its Open link. */
function appCard(page: Page, name: string) {
  return main(page)
    .locator("div")
    .filter({ has: page.getByRole("heading", { level: 2, name, exact: true }) })
    .filter({ has: page.getByRole("link", { name: "Open" }) })
    .last();
}

test.describe("applications for a staff member", () => {
  test.use({ role: "staff" });

  test("lists every application with its status and access scope", async ({ page }) => {
    await page.goto("/applications");
    for (const name of Object.values(APPS)) {
      await expect(appTitles(page).filter({ hasText: name })).toHaveCount(1);
    }
    await expect(appCard(page, APPS.payroll)).toContainText("Active");
    await expect(appCard(page, APPS.payroll)).toContainText("All Users");
    await expect(appCard(page, APPS.fleet)).toContainText("Restricted");
    await expect(appCard(page, APPS.ledger)).toContainText("Maintenance");
    await expect(appCard(page, APPS.archive)).toContainText("Inactive");
    await expect(main(page).getByRole("button", { name: "Manage" })).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: "Create New Application" })).toHaveCount(0);
  });

  test("counts the applications their department can use", async ({ page }) => {
    await page.goto("/applications");
    await expectSequence(main(page), "Accessible to You", 2);
  });

  test("narrows the list to the ones they can use", async ({ page }) => {
    await page.goto("/applications");
    await main(page).getByRole("button", { name: "My Accessible" }).click();
    await expect(appTitles(page)).toHaveText([APPS.fleet, APPS.payroll]);
    await main(page).getByRole("button", { name: "All Applications" }).click();
    await expect(appTitles(page).filter({ hasText: APPS.itConsole })).toHaveCount(1);
  });

  test("searches by name", async ({ page }) => {
    await page.goto("/applications");
    await main(page).getByRole("textbox", { name: "Search applications by name..." }).fill("fleet");
    await expect(appTitles(page)).toHaveText([APPS.fleet]);
  });

  test("is refused when opening an application outside their department", async ({ page }) => {
    await page.goto("/applications");
    await appCard(page, APPS.itConsole).getByRole("link", { name: "Open" }).click();
    await expectToast(page, "You do not have access to this application. If this was a mistake, contact admin");
  });
});

test.describe("application access rules", () => {
  test.describe("a user with an explicit allowance", () => {
    test.use({ role: "peer" });
    test("can use an application outside their department", async ({ page }) => {
      await page.goto("/applications");
      await expectSequence(main(page), "Accessible to You", 3);
      await main(page).getByRole("button", { name: "My Accessible" }).click();
      await expect(appTitles(page)).toHaveText([APPS.fleet, APPS.itConsole, APPS.payroll]);
    });
  });

  test.describe("a user with an explicit denial", () => {
    test.use({ role: "warehouse" });
    test("loses an application their department normally has", async ({ page }) => {
      await page.goto("/applications");
      await expectSequence(main(page), "Accessible to You", 1);
      await appCard(page, APPS.fleet).getByRole("link", { name: "Open" }).click();
      await expectToast(page, "You do not have access to this application. If this was a mistake, contact admin");
    });
  });

  test.describe("an executive", () => {
    test.use({ role: "director" });
    test("can use every application but cannot manage them", async ({ page }) => {
      await page.goto("/applications");
      await expectSequence(main(page), "Accessible to You", 5);
      await expect(main(page).getByRole("button", { name: "Manage" })).toHaveCount(0);
    });
  });
});

test.describe("opening an application", () => {
  test.use({ role: "itstaff" });

  test("opens it in a new tab and remembers it on the dashboard", async ({ page, context }) => {
    await context.route("https://*.e2e.test/**", (route) => route.fulfill({ body: "application" }));
    await page.goto("/applications");

    const popup = context.waitForEvent("page");
    await appCard(page, APPS.itConsole).getByRole("link", { name: "Open" }).click();
    await expect((await popup).url()).toContain("https://itconsole.e2e.test");

    await page.goto("/dashboard");
    await expect(main(page).getByText("Recent applications")).toBeVisible();
    await expect(main(page).getByText(APPS.itConsole, { exact: true })).toBeVisible();
  });
});

test.describe("managing applications as an administrator", () => {
  test.use({ role: "admin" });

  async function createApplication(page: Page, name: string, slug: string) {
    await page.goto("/applications");
    await main(page).getByRole("button", { name: "Create New Application" }).click();
    const dialog = page.getByRole("dialog", { name: "Create Application" });
    await dialog.getByRole("textbox", { name: "Application Name" }).fill(name);
    await dialog.getByRole("textbox", { name: "Slug" }).fill(slug);
    await dialog.getByRole("textbox", { name: "Description" }).fill("Created by an end-to-end test.");
    await dialog.getByRole("textbox", { name: "Application URL" }).fill(`https://${slug}.e2e.test`);
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByRole("checkbox", { name: "IT" }).check();
    await dialog.getByRole("button", { name: "Create Application" }).click();
    await expect(dialog).toBeHidden();
    await expect(appTitles(page).filter({ hasText: name })).toHaveCount(1);
  }

  test("sees management controls and a department filter", async ({ page }) => {
    await page.goto("/applications");
    await expect(main(page).getByRole("button", { name: "Create New Application" })).toBeVisible();
    await expect(appCard(page, APPS.payroll).getByRole("button", { name: "Manage" })).toBeVisible();

    await main(page).getByRole("button", { name: "Operations", exact: true }).click();
    await expect(appTitles(page).filter({ hasText: APPS.fleet })).toHaveCount(1);
    await expect(appTitles(page).filter({ hasText: APPS.itConsole })).toHaveCount(0);
    await expect(appTitles(page).filter({ hasText: APPS.payroll })).toHaveCount(0);
  });

  test("requires a department for a restricted application", async ({ page }) => {
    await page.goto("/applications");
    await main(page).getByRole("button", { name: "Create New Application" }).click();
    const dialog = page.getByRole("dialog", { name: "Create Application" });
    await dialog.getByRole("textbox", { name: "Application Name" }).fill("No Department App");
    await dialog.getByRole("textbox", { name: "Slug" }).fill(`no-dept-${Date.now()}`);
    await dialog.getByRole("textbox", { name: "Application URL" }).fill("https://nodept.e2e.test");
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByText("Required when access scope is set to Restricted.")).toBeVisible();
    await dialog.getByRole("button", { name: "Create Application" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(appTitles(page).filter({ hasText: "No Department App" })).toHaveCount(0);
  });

  test("creates a restricted application that only the chosen department can use", async ({ page, browser }) => {
    const name = unique("Asset Scanner");
    await createApplication(page, name, `asset-scanner-${Date.now()}`);
    await expect(appCard(page, name)).toContainText("Restricted");

    const technician = await pageAs(browser, "itstaff");
    await technician.goto("/applications");
    await technician.getByRole("main").getByRole("button", { name: "My Accessible" }).click();
    await expect(technician.getByRole("main").getByRole("heading", { level: 2, name })).toBeVisible();
    await technician.context().close();

    const clerk = await pageAs(browser, "clerk");
    await clerk.goto("/applications");
    await clerk.getByRole("main").getByRole("button", { name: "My Accessible" }).click();
    await expect(clerk.getByRole("main").getByRole("heading", { level: 2, name: APPS.payroll })).toBeVisible();
    await expect(clerk.getByRole("main").getByRole("heading", { level: 2, name })).toHaveCount(0);
    await clerk.context().close();
  });

  test("rejects a slug that is already taken", async ({ page }) => {
    await page.goto("/applications");
    await main(page).getByRole("button", { name: "Create New Application" }).click();
    const dialog = page.getByRole("dialog", { name: "Create Application" });
    await dialog.getByRole("textbox", { name: "Application Name" }).fill("Duplicate Payroll");
    await dialog.getByRole("textbox", { name: "Slug" }).fill("payroll-hub");
    await dialog.getByRole("textbox", { name: "Application URL" }).fill("https://dup.e2e.test");
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByRole("checkbox", { name: "IT" }).check();
    await dialog.getByRole("button", { name: "Create Application" }).click();
    await expect(page.getByText(/slug/i).filter({ hasText: /already exists/i }).first()).toBeVisible();
  });

  test("edits an application's description and status", async ({ page }) => {
    const name = unique("Badge Printer");
    await createApplication(page, name, `badge-printer-${Date.now()}`);

    await appCard(page, name).getByRole("button", { name: "Manage" }).click();
    const dialog = page.getByRole("dialog", { name: `Manage ${name}` });
    await dialog.getByRole("textbox", { name: "Description" }).fill("Prints visitor badges.");
    await choose(page, dialog.getByRole("combobox", { name: "Status" }), "Maintenance");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expectToast(page, /updated/i);
    // The dialog stays open after saving, showing the saved values.
    await expect(dialog.getByRole("combobox", { name: "Status" })).toHaveText("Maintenance");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    await expect(appCard(page, name)).toContainText("Prints visitor badges.");
    await expect(appCard(page, name)).toContainText("Maintenance");
  });

  test("grants one person access to an application outside their department", async ({ page, browser }) => {
    const name = unique("Server Monitor");
    await createApplication(page, name, `server-monitor-${Date.now()}`);

    await appCard(page, name).getByRole("button", { name: "Manage" }).click();
    const dialog = page.getByRole("dialog", { name: `Manage ${name}` });
    await dialog.getByRole("button", { name: "Access Control" }).click();
    await choose(page, dialog.getByRole("combobox").nth(1), /clerk@e2e\.test|Chidi Clerk/, "clerk");
    await dialog.getByRole("textbox", { name: "Reason (optional)" }).first().fill("Month-end support");
    await dialog.getByRole("button", { name: "Grant Access" }).click();
    await expectToast(page, "Access granted.");

    const clerk = await pageAs(browser, "clerk");
    await clerk.goto("/applications");
    await clerk.getByRole("main").getByRole("button", { name: "My Accessible" }).click();
    await expect(clerk.getByRole("main").getByRole("heading", { level: 2, name })).toBeVisible();
    await clerk.context().close();
  });
});
