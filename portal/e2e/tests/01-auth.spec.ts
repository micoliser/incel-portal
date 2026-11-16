import { FORMER_USER, PASSWORD, USERS } from "../support/seed";
import { expect, test } from "../support/fixtures";
import { header, main, sidebar } from "../support/ui";

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

  test("rejects an unknown account", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox", { name: "Company Email Address" }).fill(`nobody-${Date.now()}@e2e.test`);
    await page.getByRole("textbox", { name: "Password" }).fill("Wrong-Password-1");
    await page.getByRole("button", { name: "Sign in to Workspace" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid credentials." })).toBeVisible();
    await expect(page).toHaveURL("/");
  });

  test("rejects a wrong password, then accepts the right one", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox", { name: "Company Email Address" }).fill(USERS.warehouse.email);
    await page.getByRole("textbox", { name: "Password" }).fill("Wrong-Password-1");
    await page.getByRole("button", { name: "Sign in to Workspace" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid credentials." })).toBeVisible();

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

  test("sends a signed-out visitor to the sign-in page", async ({ page }) => {
    await page.goto("/todos");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: "Sign in to Workspace" })).toBeVisible();
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
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: "Sign in to Workspace" })).toBeVisible();
  });
});

test.describe("password recovery", () => {
  test("reports an email address that has no account", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByRole("textbox", { name: "Company Email Address" }).fill(`nobody-${Date.now()}@e2e.test`);
    await page.getByRole("button", { name: "Send Reset Link" }).click();
    await expect(main(page).getByText(/No account found with this email address/)).toBeVisible();
  });

  test("confirms that a reset link was sent for a real account", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByRole("textbox", { name: "Company Email Address" }).fill(USERS.clerk.email);
    await page.getByRole("button", { name: "Send Reset Link" }).click();
    await expect(main(page).getByText(/reset link has been sent|check your email/i).first()).toBeVisible();
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
