import type { Page } from "@playwright/test";

import { PASSWORD, USERS } from "../support/seed";
import { expect, test } from "../support/fixtures";
import { header, sidebar } from "../support/ui";

// Chika Changer's password is changed here, so this file runs last and its
// tests run in order.
test.describe.configure({ mode: "serial" });

const NEW_PASSWORD = "Changed-Portal!2027";

async function openChangePassword(page: Page) {
  await page.goto("/dashboard");
  await header(page).getByRole("button", { name: "Change password" }).click();
  const dialog = page.getByRole("dialog", { name: "Change password" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Company Email Address" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in to Workspace" }).click();
}

test.describe("changing your own password", () => {
  test.use({ role: "changer" });

  test("rejects a confirmation that does not match", async ({ page }) => {
    const dialog = await openChangePassword(page);
    await dialog.getByRole("textbox", { name: "Old password" }).fill(PASSWORD);
    await dialog.getByRole("textbox", { name: "New password" }).fill(NEW_PASSWORD);
    await dialog.getByRole("textbox", { name: "Confirm password" }).fill(NEW_PASSWORD + "x");
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/do not match/i).first()).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("rejects a wrong current password", async ({ page }) => {
    const dialog = await openChangePassword(page);
    await dialog.getByRole("textbox", { name: "Old password" }).fill("Not-My-Password-1");
    await dialog.getByRole("textbox", { name: "New password" }).fill(NEW_PASSWORD);
    await dialog.getByRole("textbox", { name: "Confirm password" }).fill(NEW_PASSWORD);
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/Old password is incorrect\./).first()).toBeVisible();
  });

  test("rejects a new password that is too common", async ({ page }) => {
    const dialog = await openChangePassword(page);
    await dialog.getByRole("textbox", { name: "Old password" }).fill(PASSWORD);
    await dialog.getByRole("textbox", { name: "New password" }).fill("password123");
    await dialog.getByRole("textbox", { name: "Confirm password" }).fill("password123");
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/too common/i).first()).toBeVisible();
  });

  test("accepts a valid change and keeps the user signed in", async ({ page }) => {
    const dialog = await openChangePassword(page);
    await dialog.getByRole("textbox", { name: "Old password" }).fill(PASSWORD);
    await dialog.getByRole("textbox", { name: "New password" }).fill(NEW_PASSWORD);
    await dialog.getByRole("textbox", { name: "Confirm password" }).fill(NEW_PASSWORD);
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(header(page).getByText(USERS.changer.name)).toBeVisible();
    await expect(sidebar(page).getByRole("button", { name: "Log out" })).toBeVisible();
  });
});

test.describe("signing in after a password change", () => {
  test("refuses the old password and accepts the new one", async ({ page }) => {
    await signIn(page, USERS.changer.email, PASSWORD);
    await expect(page.getByRole("alert").filter({ hasText: "Invalid credentials." })).toBeVisible();

    await signIn(page, USERS.changer.email, NEW_PASSWORD);
    await expect(page).toHaveURL("/dashboard");
    await expect(header(page).getByText(USERS.changer.name)).toBeVisible();
  });
});
