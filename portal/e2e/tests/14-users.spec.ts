import type { Browser, Page } from "@playwright/test";

import { FORMER_USER, PASSWORD, USERS } from "../support/seed";
import { expect, test } from "../support/fixtures";
import { emailCount, setPasswordFromEmail, signedOutPage } from "../support/mail";
import { choose, expectSequence, expectToast, main } from "../support/ui";

function userRow(page: Page, email: string) {
  return main(page).getByRole("row").filter({ has: page.getByText(email, { exact: true }) });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Company Email Address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in to Workspace" }).click();
}

/** Creates an account. No password is involved: the new user is emailed a link. */
async function createUser(page: Page, first: string, last: string, email: string) {
  await page.goto("/users");
  await main(page).getByRole("button", { name: "Create User" }).click();
  const dialog = page.getByRole("dialog", { name: "Create User" });
  await dialog.getByRole("textbox", { name: "First Name *" }).fill(first);
  await dialog.getByRole("textbox", { name: "Last Name" }).fill(last);
  await dialog.getByRole("textbox", { name: "Work Email *" }).fill(email);
  await choose(page, dialog.getByRole("combobox", { name: "Department" }), "Finance");
  await dialog.getByRole("button", { name: "Create User" }).click();
  await expect(dialog).toBeHidden();
}

/** Creates an account and has the new user choose a password from their emailed link. */
async function createUserWithPassword(
  page: Page,
  browser: Browser,
  first: string,
  last: string,
  email: string,
  password = PASSWORD,
) {
  await createUser(page, first, last, email);
  const fresh = await signedOutPage(browser);
  await setPasswordFromEmail(fresh, email, password);
  await fresh.context().close();
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

  test("asks for no password and rejects an email that is already in use", async ({ page }) => {
    await page.goto("/users");
    await main(page).getByRole("button", { name: "Create User" }).click();
    const dialog = page.getByRole("dialog", { name: "Create User" });
    await expect(dialog.getByText(/emailed a link to\s+set their own password/)).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: /password/i })).toHaveCount(0);

    await dialog.getByRole("textbox", { name: "First Name *" }).fill("Dup");
    await dialog.getByRole("textbox", { name: "Last Name" }).fill("Licate");
    await dialog.getByRole("textbox", { name: "Work Email *" }).fill(USERS.staff.email);
    await dialog.getByRole("button", { name: "Create User" }).click();
    await expect(dialog.getByRole("alert")).toContainText("A user with this email already exists.");
    await expect(dialog).toBeVisible();
  });

  test("creates a user who sets their own password from the emailed link and signs in", async ({ page, browser }) => {
    const email = `new.hire.${Date.now()}@e2e.test`;
    await createUser(page, "Nia", "Newhire", email);

    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(email);
    const row = userRow(page, email);
    await expect(row).toContainText("Nia Newhire");
    await expect(row).toContainText("Finance");
    await expect(row).toContainText("Active");

    // Until the link is used the account has no password, so nothing signs in.
    const fresh = await signedOutPage(browser);
    await signIn(fresh, email, PASSWORD);
    await expect(fresh.getByRole("alert").filter({ hasText: "Invalid credentials." })).toBeVisible();

    await setPasswordFromEmail(fresh, email, PASSWORD);
    await signIn(fresh, email, PASSWORD);
    await expect(fresh).toHaveURL("/dashboard");
    await expect(fresh.getByRole("banner").getByText("Nia Newhire")).toBeVisible();
    await fresh.context().close();
  });

  test("requires a last name when creating a user", async ({ page }) => {
    const email = `mono.${Date.now()}@e2e.test`;
    await page.goto("/users");
    await main(page).getByRole("button", { name: "Create User" }).click();
    const dialog = page.getByRole("dialog", { name: "Create User" });
    await expect(dialog.getByText("Last Name *")).toBeVisible();
    await dialog.getByRole("textbox", { name: "First Name *" }).fill("Mono");
    await dialog.getByRole("textbox", { name: "Work Email *" }).fill(email);
    await dialog.getByRole("button", { name: "Create User" }).click();
    await expect(dialog.getByText("Last name is required.")).toBeVisible();
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(email);
    await expect(userRow(page, email)).toHaveCount(0);
  });

  test("edits a user's name and department", async ({ page }) => {
    const email = `edit.me.${Date.now()}@e2e.test`;
    await createUser(page, "Eddy", "Editable", email);
    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(email);

    await userRow(page, email).getByRole("button", { name: "Edit user details" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit User" });
    await expect(dialog.getByRole("textbox", { name: "First Name *" })).toHaveValue("Eddy");
    await expect(dialog.getByRole("textbox", { name: "Work Email *" })).toHaveValue(email);
    await expect(dialog.getByRole("combobox", { name: "Department" })).toHaveText("Finance");

    await dialog.getByRole("textbox", { name: "Last Name" }).fill("Edited");
    await choose(page, dialog.getByRole("combobox", { name: "Department" }), "Human Resources");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(userRow(page, email)).toContainText("Eddy Edited");
    await expect(userRow(page, email)).toContainText("Human Resources");

    // The change is saved, not just shown.
    await page.reload();
    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(email);
    await expect(userRow(page, email)).toContainText("Eddy Edited");
    await expect(userRow(page, email)).toContainText("Human Resources");
  });

  test("requires a last name when editing a user", async ({ page }) => {
    const email = `keep.name.${Date.now()}@e2e.test`;
    await createUser(page, "Kemi", "Keepname", email);
    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(email);

    await userRow(page, email).getByRole("button", { name: "Edit user details" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit User" });
    await dialog.getByRole("textbox", { name: "Last Name" }).fill("");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog.getByText("Last name is required.")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(userRow(page, email)).toContainText("Kemi Keepname");
  });

  test("sends a reset link from the edit dialog, which the user follows to choose a new password", async ({ page, browser }) => {
    const email = `reset.me.${Date.now()}@e2e.test`;
    const newPassword = "Fresh-Start!2027";
    await createUserWithPassword(page, browser, "Rita", "Reset", email);
    const sentBefore = emailCount(email);
    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(email);

    await userRow(page, email).getByRole("button", { name: "Edit user details" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit User" });
    // An administrator cannot type a password for someone else.
    await expect(dialog.getByRole("textbox", { name: /password/i })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Send password reset link" }).click();
    await expectToast(page, `Password reset link sent to ${email}.`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(() => emailCount(email)).toBeGreaterThan(sentBefore);

    // Sending the link changes nothing by itself: the old password still works.
    const fresh = await signedOutPage(browser);
    await signIn(fresh, email, PASSWORD);
    await expect(fresh).toHaveURL("/dashboard");
    await fresh.context().close();

    // Once the user chooses a new password, the old one stops working.
    const again = await signedOutPage(browser);
    await setPasswordFromEmail(again, email, newPassword);
    await signIn(again, email, PASSWORD);
    await expect(again.getByRole("alert").filter({ hasText: "Invalid credentials." })).toBeVisible();
    await signIn(again, email, newPassword);
    await expect(again).toHaveURL("/dashboard");
    await again.context().close();
  });

  test("disables an account, which blocks sign-in, then enables it again", async ({ page, browser }) => {
    const email = `toggle.me.${Date.now()}@e2e.test`;
    await createUserWithPassword(page, browser, "Tobi", "Toggle", email);
    await main(page).getByRole("textbox", { name: "Search by name or email..." }).fill(email);

    await userRow(page, email).getByRole("button", { name: "Disable user account" }).click();
    const disabling = page.getByRole("dialog", { name: "Disable User Account" });
    await expect(disabling).toContainText(`Are you sure you want to disable access for Tobi Toggle (${email})?`);
    await disabling.getByRole("button", { name: "Disable User" }).click();
    await expect(disabling).toBeHidden();
    // The row updates without reloading the page.
    await expect(userRow(page, email)).toContainText("Disabled");

    const fresh = await signedOutPage(browser);
    await signIn(fresh, email, PASSWORD);
    await expect(fresh.getByText("This account has been disabled, contact HR or Admin.")).toBeVisible();

    await userRow(page, email).getByRole("button", { name: "Enable user account" }).click();
    const enabling = page.getByRole("dialog");
    await enabling.getByRole("button", { name: /^Enable/ }).click();
    await expect(enabling).toBeHidden();
    await expect(userRow(page, email)).toContainText("Active");

    await signIn(fresh, email, PASSWORD);
    await expect(fresh).toHaveURL("/dashboard");
    await fresh.context().close();
  });
});
