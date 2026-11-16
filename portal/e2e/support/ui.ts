import { expect, type Locator, type Page } from "@playwright/test";

/** The page body, excluding the sidebar and header. */
export function main(page: Page): Locator {
  return page.getByRole("main");
}

/** The sidebar navigation of the signed-in shell. */
export function sidebar(page: Page): Locator {
  return page.getByRole("complementary").first();
}

/** The header strip showing the page title and the signed-in user. */
export function header(page: Page): Locator {
  return page.getByRole("banner");
}

/** Asserts that a toast containing the text is shown. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(
    page.getByRole("region", { name: /Notifications/ }).getByText(text).first(),
  ).toBeVisible();
}

/** A short unique suffix so tests can be re-run against the same database. */
export function unique(label: string): string {
  return `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Asserts that the pieces of text appear next to each other, in order, inside
 * the scope. Use it for labels and values that are rendered as separate
 * elements, such as a stat card ("Pending" / "2").
 */
export async function expectSequence(scope: Locator, ...parts: Array<string | number>) {
  const pattern = parts.map((part) => escapeRegExp(String(part))).join("\\s*");
  // "8" must not match the start of "80".
  const endsWithNumber = /\d$/.test(String(parts[parts.length - 1]));
  await expect(scope).toContainText(new RegExp(endsWithNumber ? `${pattern}(?!\\d)` : pattern));
}

/**
 * Picks an option from one of the portal's custom dropdowns: opens it, types a
 * search term when one is given, and clicks the matching option.
 */
export async function choose(page: Page, dropdown: Locator, option: string | RegExp, search?: string) {
  await dropdown.click();
  if (search) {
    await page.keyboard.type(search);
  }
  await page.getByRole("option", { name: option }).first().click();
}
