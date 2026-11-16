import type { Browser, Page } from "@playwright/test";

import { FORMER_USER, PASSWORD, USERS } from "../support/seed";
import { expect, test } from "../support/fixtures";
import { choose, expectSequence, main } from "../support/ui";

function userRow(page: Page, email: string) {
  return main(page).getByRole("row").filter({ has: page.getByText(email, { exact: true }) });
}

/** A browser session with nobody signed in. */
async function signedOutPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return context.newPage();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Company Email Address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in to Workspace" }).click();
}

async function createUser(page: Page, first: string, last: string, email: string, password = PASSWORD) {
  await page.goto("/users");
  await main(page).getByRole("button", { name: "Create User" }).click();
  const dialog = page.getByRole("dialog", { name: "Create User" });
  await dialog.getByRole("textbox", { name: "First Name *" }).fill(first);
  await dialog.getByRole("textbox", { name: "Last Name" }).fill(last);
  await dialog.getByRole("textbox", { name: "Work Email *" }).fill(email);
  await dialog.getByRole("textbox", { name: "Password *", exact: true }).fill(password);
  await dialog.getByRole("textbox", { name: "Confirm Password *" }).fill(password);
  await choose(page, dialog.getByRole("combobox", { name: "Department" }), "Finance");
  await dialog.getByRole("button", { name: "Create User" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("user directory for an executive (read-only)", () => {
  test.use({ role: "director" });

  test("counts users by state", async ({ page }) => {
    await page.goto("/users");
    const body = main(page);
    await expectSequence(body, "Total Users", 16);
    await expectSequence(body, "Active Accounts", 15);
    await expectSequence(body, "Disabled Accounts", 1);
    await expectSequence(body, "Departments", 4);
    await expectSequence(body, "Showing", 16, "of 16 users");
  });

  test("lists each person with department, role and status", async ({ page }) => {
    await page.goto("/users");
    const stan = userRow(page, USERS.staff.email);
    await expect(stan).toContainText("Stan Staff");
    await expect(stan).toContainText("Operations");
    await expect(stan).toContainText("Staff");
    await expect(stan).toContainText("Active");
    await expect(userRow(page, USERS.director.email)).toContainText("ED");
    await expect(userRow(page, FORMER_USER.email)).toContainText("Disabled");
  });

  test("has no create or edit controls", async ({ page }) => {
    await page.goto("/users");
    await expect(userRow(page, USERS.staff.email)).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Create User" })).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: "Edit user details" })).toHaveCount(0);
  });

  test("searches by name or email", async ({ page }) => {
    await page.goto("/users");
    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill("technician");
    await expect(userRow(page, USERS.itstaff.email)).toBeVisible();
    await expect(main(page).getByRole("row")).toHaveCount(2);
  });

  test("filters to disabled accounts", async ({ page }) => {
    await page.goto("/users");
    await main(page).getByRole("button", { name: "Disabled", exact: true }).click();
    await expect(userRow(page, FORMER_USER.email)).toBeVisible();
    await expect(main(page).getByRole("row")).toHaveCount(2);
  });

  test("filters by department", async ({ page }) => {
    await page.goto("/users");
    await choose(page, main(page).getByRole("combobox"), "IT");
    await expect(userRow(page, USERS.itmanager.email)).toBeVisible();
    await expect(userRow(page, USERS.itstaff.email)).toBeVisible();
    await expect(main(page).getByRole("row")).toHaveCount(3);
  });
});

test.describe("managing users as an administrator", () => {
  test.use({ role: "admin" });

  test("rejects mismatched passwords and an email that is already in use", async ({ page }) => {
    await page.goto("/users");
    await main(page).getByRole("button", { name: "Create User" }).click();
    const dialog = page.getByRole("dialog", { name: "Create User" });
    await dialog.getByRole("textbox", { name: "First Name *" }).fill("Dup");
    await dialog.getByRole("textbox", { name: "Last Name" }).fill("Licate");
    await dialog.getByRole("textbox", { name: "Work Email *" }).fill(USERS.staff.email);
    await dialog.getByRole("textbox", { name: "Password *", exact: true }).fill(PASSWORD);
    await dialog.getByRole("textbox", { name: "Confirm Password *" }).fill(PASSWORD + "x");
    await dialog.getByRole("button", { name: "Create User" }).click();
    await expect(dialog.getByText(/do not match/i)).toBeVisible();

    await dialog.getByRole("textbox", { name: "Confirm Password *" }).fill(PASSWORD);
    await dialog.getByRole("button", { name: "Create User" }).click();
    await expect(dialog.getByRole("alert")).toContainText("A user with this email already exists.");
    await expect(dialog).toBeVisible();
  });

  test("creates a user who can then sign in", async ({ page, browser }) => {
    const email = `new.hire.${Date.now()}@e2e.test`;
    await createUser(page, "Nia", "Newhire", email);

    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(email);
    const row = userRow(page, email);
    await expect(row).toContainText("Nia Newhire");
    await expect(row).toContainText("Finance");
    await expect(row).toContainText("Active");

    const fresh = await signedOutPage(browser);
    await signIn(fresh, email, PASSWORD);
    await expect(fresh).toHaveURL("/dashboard");
    await expect(fresh.getByRole("banner").getByText("Nia Newhire")).toBeVisible();
    await fresh.context().close();
  });

  test("requires a last name even though the form marks it optional", async ({ page }) => {
    await page.goto("/users");
    await main(page).getByRole("button", { name: "Create User" }).click();
    const dialog = page.getByRole("dialog", { name: "Create User" });
    await dialog.getByRole("textbox", { name: "First Name *" }).fill("Mono");
    await dialog.getByRole("textbox", { name: "Work Email *" }).fill(`mono.${Date.now()}@e2e.test`);
    await dialog.getByRole("textbox", { name: "Password *", exact: true }).fill(PASSWORD);
    await dialog.getByRole("textbox", { name: "Confirm Password *" }).fill(PASSWORD);
    await dialog.getByRole("button", { name: "Create User" }).click();
    await expect(dialog.getByRole("alert")).toContainText("last_name: This field may not be blank.");
  });

  // KNOWN DEFECT, recorded as it behaves today: the Edit User dialog cannot save.
  // The portal sends the change with a method the API rejects, so every edit
  // (including a password reset from this dialog) fails with this message.
  test("fails to save an edit to a user", async ({ page }) => {
    const email = `edit.me.${Date.now()}@e2e.test`;
    await createUser(page, "Eddy", "Editable", email);
    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(email);

    await userRow(page, email).getByRole("button", { name: "Edit user details" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit User" });
    await expect(dialog.getByRole("textbox", { name: "First Name *" })).toHaveValue("Eddy");
    await expect(dialog.getByRole("textbox", { name: "Work Email *" })).toHaveValue(email);
    await expect(dialog.getByRole("combobox", { name: "Department" })).toHaveText("Finance");

    await dialog.getByRole("textbox", { name: "Last Name" }).fill("Edited");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog.getByRole("alert")).toHaveText('Method "PUT" not allowed.');
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(userRow(page, email)).toContainText("Eddy Editable");
  });

  test("offers a password reset inside the edit dialog", async ({ page }) => {
    await page.goto("/users");
    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(USERS.clerk.email);
    await userRow(page, USERS.clerk.email).getByRole("button", { name: "Edit user details" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit User" });
    await expect(dialog.getByRole("textbox", { name: "New Password" })).toHaveCount(0);
    await dialog.getByRole("checkbox", { name: "Reset User Password" }).check();
    await expect(dialog.getByRole("textbox", { name: "New Password" })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Confirm New" })).toBeVisible();
  });

  test("disables an account, which blocks sign-in, then enables it again", async ({ page, browser }) => {
    const email = `toggle.me.${Date.now()}@e2e.test`;
    await createUser(page, "Tobi", "Toggle", email);
    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(email);

    await userRow(page, email).getByRole("button", { name: "Disable user account" }).click();
    const disabling = page.getByRole("dialog", { name: "Disable User Account" });
    await expect(disabling).toContainText(`Are you sure you want to disable access for Tobi Toggle (${email})?`);
    await disabling.getByRole("button", { name: "Disable User" }).click();
    await expect(disabling).toBeHidden();
    await page.reload();
    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(email);
    await expect(userRow(page, email)).toContainText("Disabled");

    const fresh = await signedOutPage(browser);
    await signIn(fresh, email, PASSWORD);
    await expect(fresh.getByText("This account has been disabled, contact HR or Admin.")).toBeVisible();

    await userRow(page, email).getByRole("button", { name: "Enable user account" }).click();
    const enabling = page.getByRole("dialog");
    await enabling.getByRole("button", { name: /^Enable/ }).click();
    await expect(enabling).toBeHidden();
    await page.reload();
    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(email);
    await expect(userRow(page, email)).toContainText("Active");

    await signIn(fresh, email, PASSWORD);
    await expect(fresh).toHaveURL("/dashboard");
    await fresh.context().close();
  });
});
