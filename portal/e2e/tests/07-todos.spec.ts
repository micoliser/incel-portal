import type { Page } from "@playwright/test";

import { TODOS } from "../support/seed";
import { expect, test } from "../support/fixtures";
import { main, unique } from "../support/ui";

function todoTitles(page: Page) {
  return main(page).getByRole("heading", { level: 3 });
}

const CAPTURE = /What needs to be done/;

async function addTodo(page: Page, title: string) {
  await main(page).getByRole("textbox", { name: CAPTURE }).fill(title);
  await page.keyboard.press("Enter");
  await expect(todoTitles(page).filter({ hasText: title })).toBeVisible();
}

/** The row for one to-do: the smallest block holding its title and its buttons. */
function todoRow(page: Page, title: string) {
  return main(page)
    .locator("div")
    .filter({ has: page.getByRole("heading", { level: 3, name: title, exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Delete to-do" }) })
    .last();
}

test.describe("to-do list for a staff member", () => {
  test.use({ role: "staff" });

  test("groups their to-dos by due date and counts them", async ({ page }) => {
    await page.goto("/todos");
    const body = main(page);
    await expect(body.getByText("Total: 5")).toBeVisible();
    await expect(body.getByRole("button", { name: "All 5" })).toBeVisible();
    await expect(body.getByRole("button", { name: "Today 3" })).toBeVisible();
    await expect(body.getByRole("button", { name: "Upcoming 1" })).toBeVisible();
    await expect(body.getByRole("button", { name: "Overdue 1" })).toBeVisible();
    await expect(body.getByRole("button", { name: "Completed 1" })).toBeVisible();
    await expect(body.getByRole("heading", { level: 2 })).toHaveText(["Overdue", "Today", "Upcoming", "No Due Date"]);
    await expect(todoTitles(page)).toHaveText([
      TODOS.overdue, TODOS.today, TODOS.completed, TODOS.upcoming, TODOS.undated,
    ]);
  });

  test("never shows another person's to-dos", async ({ page }) => {
    await page.goto("/todos");
    await expect(todoTitles(page)).toHaveCount(5);
    await expect(main(page).getByText(TODOS.peerOnly)).toHaveCount(0);
  });

  test("filters by tab", async ({ page }) => {
    await page.goto("/todos");
    const body = main(page);
    await body.getByRole("button", { name: "Upcoming 1" }).click();
    await expect(todoTitles(page)).toHaveText([TODOS.upcoming]);
    await body.getByRole("button", { name: "Overdue 1" }).click();
    await expect(todoTitles(page)).toHaveText([TODOS.overdue]);
    await body.getByRole("button", { name: "Completed 1" }).click();
    await expect(todoTitles(page)).toHaveText([TODOS.completed]);
  });

  test("filters by priority and by search text", async ({ page }) => {
    await page.goto("/todos");
    const body = main(page);
    await body.getByRole("combobox").selectOption({ label: "High Priority" });
    await expect(todoTitles(page)).toHaveText([TODOS.today]);

    // Changing the filter and searching straight away: the search result must
    // win even if the "all priorities" answer arrives later.
    await body.getByRole("combobox").selectOption({ label: "All Priorities" });
    await body.getByRole("textbox", { name: "Search to-dos..." }).fill("forklift");
    await expect(todoTitles(page)).toHaveText([TODOS.upcoming]);
  });
});

test.describe("managing to-dos", () => {
  test.use({ role: "clerk" });

  test("adds a to-do from the capture bar", async ({ page }) => {
    await page.goto("/todos");
    const title = unique("Order printer paper");
    await addTodo(page, title);
    await expect(main(page).getByRole("textbox", { name: CAPTURE })).toHaveValue("");
    await expect(todoRow(page, title)).toContainText("Medium");

    await page.reload();
    await expect(todoTitles(page).filter({ hasText: title })).toBeVisible();
  });

  test("completes a to-do and reopens it", async ({ page }) => {
    await page.goto("/todos");
    const title = unique("Sign expense forms");
    await addTodo(page, title);

    await todoRow(page, title).getByRole("button", { name: "Mark complete" }).click();
    await expect(todoRow(page, title).getByRole("button", { name: "Mark incomplete" })).toBeVisible();

    await todoRow(page, title).getByRole("button", { name: "Mark incomplete" }).click();
    await expect(todoRow(page, title).getByRole("button", { name: "Mark complete" })).toBeVisible();
  });

  test("edits title, priority and due date", async ({ page }) => {
    await page.goto("/todos");
    const title = unique("Review contract");
    const renamed = `${title} today`;
    await addTodo(page, title);

    await todoRow(page, title).getByRole("button", { name: "Edit to-do" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit To-Do" });
    await dialog.getByRole("textbox", { name: "Task title..." }).fill(renamed);
    await dialog.getByRole("combobox").selectOption({ label: "High Priority" });
    await dialog.locator('input[type="date"]').fill(new Date().toISOString().slice(0, 10));
    await dialog.locator('input[type="time"]').fill("23:45");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();

    const row = todoRow(page, renamed);
    await expect(row).toContainText("High");
    await expect(row).toContainText("Today, 11:45 PM");
  });

  test("deletes a to-do", async ({ page }) => {
    await page.goto("/todos");
    const title = unique("Cancel old subscription");
    await addTodo(page, title);

    await todoRow(page, title).getByRole("button", { name: "Delete to-do" }).click();
    const deleting = page.getByRole("dialog", { name: "Delete To-Do?" });
    await expect(deleting).toContainText(title);
    await deleting.getByRole("button", { name: "Delete To-Do" }).click();
    await expect(deleting).toBeHidden();
    await expect(todoTitles(page).filter({ hasText: title })).toHaveCount(0);

    await page.reload();
    await expect(todoTitles(page).filter({ hasText: title })).toHaveCount(0);
  });

  test("clears every completed to-do at once", async ({ page }) => {
    await page.goto("/todos");
    const first = unique("Shred old files");
    const second = unique("Water the plants");
    await addTodo(page, first);
    await addTodo(page, second);
    await todoRow(page, first).getByRole("button", { name: "Mark complete" }).click();
    await expect(todoRow(page, first).getByRole("button", { name: "Mark incomplete" })).toBeVisible();

    await main(page).getByRole("button", { name: /Clear Completed/ }).click();
    const clearing = page.getByRole("dialog", { name: "Clear Completed To-Dos?" });
    await expect(clearing).toContainText(/permanently delete all \d+ completed to-dos/);
    await clearing.getByRole("button", { name: "Delete Completed" }).click();
    await expect(clearing).toBeHidden();
    await expect(todoTitles(page).filter({ hasText: first })).toHaveCount(0);
    await expect(todoTitles(page).filter({ hasText: second })).toBeVisible();
    await expect(main(page).getByRole("button", { name: /Clear Completed/ })).toHaveCount(0);
  });
});
