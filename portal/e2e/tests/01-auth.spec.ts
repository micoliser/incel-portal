import type { Page } from "@playwright/test";

import { FORMER_USER, PASSWORD, USERS } from "../support/seed";
import { expect, test } from "../support/fixtures";
import { emailCount, passwordLinkFor } from "../support/mail";
import { header, main, sidebar } from "../support/ui";

/**
 * The sign-in error box. Next.js also renders an empty alert for route
 * announcements, so the box is picked out by its text.
 */
function signInError(page: Page) {
  return page.getByRole("alert").filter({ hasText: "Invalid credentials." });
}

test.describe("signing in", () => {
  test("shows the sign-in form to a signed-out visitor", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome back to your workspace." })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Company Email Address" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
  });

  test("validates the form before contacting the server", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in to Workspace" }).click();
    await expect(page.getByText("Email address is required.")).toBeVisible();
    await expect(page.getByText("Password is required.")).toBeVisible();

    await page.getByRole("textbox", { name: "Company Email Address" }).fill("not-an-email");
    await page.getByRole("textbox", { name: "Password" }).fill("short");
    await page.getByRole("button", { name: "Sign in to Workspace" }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Password must be at least 8 characters long.")).toBeVisible();
  });

  test("rejects an unknown account and says how many attempts are left", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox", { name: "Company Email Address" }).fill(`nobody-${Date.now()}@e2e.test`);
    await page.getByRole("textbox", { name: "Password" }).fill("Wrong-Password-1");
    await page.getByRole("button", { name: "Sign in to Workspace" }).click();
    await expect(signInError(page)).toHaveText(
      "Invalid credentials. (9 attempts remaining before lockout.)",
    );
    await expect(page).toHaveURL("/");
  });

  test("counts down the attempts left on repeated failures", async ({ page }) => {
    const email = `nobody-${Date.now()}@e2e.test`;
    await page.goto("/");
    await page.getByRole("textbox", { name: "Company Email Address" }).fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill("Wrong-Password-1");
    await page.getByRole("button", { name: "Sign in to Workspace" }).click();
    await expect(signInError(page)).toContainText("(9 attempts remaining before lockout.)");
    await page.getByRole("button", { name: "Sign in to Workspace" }).click();
    await expect(signInError(page)).toContainText("(8 attempts remaining before lockout.)");
  });

  test("rejects a wrong password, then accepts the right one", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox", { name: "Company Email Address" }).fill(USERS.warehouse.email);
    await page.getByRole("textbox", { name: "Password" }).fill("Wrong-Password-1");
    await page.getByRole("button", { name: "Sign in to Workspace" }).click();
    await expect(signInError(page)).toHaveText(
      /^Invalid credentials\. \(\d attempts remaining before lockout\.\)$/,
    );

    await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in to Workspace" }).click();
    await expect(page).toHaveURL("/dashboard");
    await expect(header(page).getByText(USERS.warehouse.name)).toBeVisible();
  });

  test("tells a deactivated user that the account is disabled", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox", { name: "Company Email Address" }).fill(FORMER_USER.email);
    await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in to Workspace" }).click();
    await expect(page.getByText("This account has been disabled, contact HR or Admin.")).toBeVisible();
    await expect(page).toHaveURL("/");
  });

  test("sends a signed-out visitor to sign in and back to the page they asked for", async ({ page }) => {
    await page.goto("/todos?view=upcoming");
    await expect(page).toHaveURL("/?next=%2Ftodos%3Fview%3Dupcoming");
    await expect(page.getByRole("button", { name: "Sign in to Workspace" })).toBeVisible();

    await page.getByRole("textbox", { name: "Company Email Address" }).fill(USERS.peer.email);
    await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in to Workspace" }).click();
    await expect(page).toHaveURL("/todos?view=upcoming");
  });

  test("returns the user to the page named in the sign-in link", async ({ page }) => {
    await page.goto("/?next=%2Ftodos");

    await page.getByRole("textbox", { name: "Company Email Address" }).fill(USERS.peer.email);
    await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in to Workspace" }).click();
    await expect(page).toHaveURL("/todos");
    await expect(header(page).getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("signed-in session", () => {
  test.use({ role: "staff" });

  test("skips the sign-in page when already signed in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/dashboard");
  });

  test("shows who is signed in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(header(page).getByText("Welcome, Stan")).toBeVisible();
    await expect(header(page).getByText(USERS.staff.name)).toBeVisible();
    await expect(header(page).getByText("Operations")).toBeVisible();
  });

  test("signs out after confirmation and blocks the portal afterwards", async ({ page }) => {
    await page.goto("/dashboard");
    await sidebar(page).getByRole("button", { name: "Log out" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /log out/i }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: "Sign in to Workspace" })).toBeVisible();

    await page.goto("/tasks");
    await expect(page).toHaveURL("/?next=%2Ftasks");
    await expect(page.getByRole("button", { name: "Sign in to Workspace" })).toBeVisible();
  });
});

test.describe("password recovery", () => {
  // The page answers the same way whether or not the address has an account,
  // so it cannot be used to find out which staff emails exist.
  const SENT = /If an active account exists for .+, an email has been sent/;

  test("gives the same answer for an address with no account, and sends nothing", async ({ page }) => {
    const address = `nobody-${Date.now()}@e2e.test`;
    await page.goto("/forgot-password");
    await page.getByRole("textbox", { name: "Company Email Address" }).fill(address);
    await page.getByRole("button", { name: "Send Reset Link" }).click();
    await expect(main(page).getByText(SENT).first()).toBeVisible();
    expect(emailCount(address)).toBe(0);
  });

  test("gives the same answer for a deactivated account, and sends nothing", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByRole("textbox", { name: "Company Email Address" }).fill(FORMER_USER.email);
    await page.getByRole("button", { name: "Send Reset Link" }).click();
    await expect(main(page).getByText(SENT).first()).toBeVisible();
    expect(emailCount(FORMER_USER.email)).toBe(0);
  });

  test("emails a working reset link to a real account", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByRole("textbox", { name: "Company Email Address" }).fill(USERS.clerk.email);
    await page.getByRole("button", { name: "Send Reset Link" }).click();
    await expect(main(page).getByText(SENT).first()).toBeVisible();

    // The emailed link opens the form to choose a new password.
    await page.goto(await passwordLinkFor(USERS.clerk.email));
    await expect(page.getByPlaceholder("Enter new password")).toBeVisible();
  });

  test("rejects a reset link with no token", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByText("Reset link expired or invalid")).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
  });

  test("rejects a reset link with a forged token", async ({ page }) => {
    await page.goto("/reset-password?uid=MQ&token=not-a-real-token");
    await expect(page.getByText("Reset link expired or invalid")).toBeVisible();
  });
});
