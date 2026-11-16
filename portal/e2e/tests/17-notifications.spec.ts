import type { Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import { header } from "../support/ui";

// Ina Inbox starts with three unread notifications. These tests change them in
// order, so they run as one sequence.
test.describe.configure({ mode: "serial" });
test.use({ role: "inbox" });

function bell(page: Page) {
  return header(page).getByRole("button", { name: "Open notifications" });
}

async function openDrawer(page: Page) {
  await page.goto("/dashboard");
  await bell(page).click();
  const drawer = page.getByRole("complementary").filter({ has: page.getByRole("heading", { name: "Notifications" }) });
  await expect(drawer).toBeVisible();
  return drawer;
}

test("the bell shows the unread count and the drawer lists them newest first", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(bell(page)).toHaveText("3");
  const drawer = await openDrawer(page);
  await expect(drawer.getByText("3 unread updates")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "All 3" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Unread 3" })).toBeVisible();
  await expect(drawer.getByRole("paragraph").filter({ hasText: /^Inbox notice (one|two|three)$/ })).toHaveText([
    "Inbox notice three", "Inbox notice two", "Inbox notice one",
  ]);
  await expect(drawer.getByText("Inbox notice two body")).toBeVisible();
});

test("the drawer closes again", async ({ page }) => {
  const drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "Close notifications" }).click();
  await expect(drawer).toBeHidden();
});

test("marking one as read lowers the count", async ({ page }) => {
  const drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "Mark read" }).first().click();
  await expect(drawer.getByText("2 unread updates")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Mark read" })).toHaveCount(2);
  await expect(bell(page)).toHaveText("2");

  await drawer.getByRole("button", { name: "Unread 2" }).click();
  await expect(drawer.getByRole("paragraph").filter({ hasText: /^Inbox notice (one|two|three)$/ })).toHaveText([
    "Inbox notice two", "Inbox notice one",
  ]);
});

test("clearing one removes it from the list", async ({ page }) => {
  const drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "Clear notification" }).first().click();
  await expect(drawer.getByText("Inbox notice three", { exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "All 2" })).toBeVisible();

  await page.reload();
  await expect(bell(page)).toHaveText("2");
});

test("opening a notification follows its link", async ({ page }) => {
  const drawer = await openDrawer(page);
  await drawer.getByRole("link", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/\/tasks/);
  await expect(drawer).toBeHidden();
  // Following the link also marks that notification as read.
  await expect(bell(page)).toHaveText("1");
});

test("marking all as read clears the badge", async ({ page }) => {
  const drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "Mark all read" }).click();
  await expect(drawer.getByRole("button", { name: "Mark read" })).toHaveCount(0);
  await expect(drawer.getByText(/unread updates/)).toHaveCount(0);
  await expect(bell(page)).not.toHaveText(/\d/);
});

test("clearing all empties the drawer", async ({ page }) => {
  const drawer = await openDrawer(page);
  await drawer.getByRole("button", { name: "Clear all" }).click();
  await expect(drawer.getByText(/^Inbox notice/)).toHaveCount(0);

  await page.reload();
  const reopened = await openDrawer(page);
  await expect(reopened.getByText(/^Inbox notice/)).toHaveCount(0);
});
