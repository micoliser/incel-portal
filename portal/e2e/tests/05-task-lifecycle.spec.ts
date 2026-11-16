import type { Page } from "@playwright/test";

import { USERS } from "../support/seed";
import { dateTimeFromNow, expect, pageAs, test } from "../support/fixtures";
import { expectSequence, main, unique } from "../support/ui";

// Femi Finance assigns work to Chidi Clerk. Nobody else's lists are affected.

function taskCards(page: Page) {
  return main(page).getByRole("link").filter({ has: page.getByRole("heading", { level: 3 }) });
}

async function createTask(page: Page, title: string, options: { priority?: string; description?: string } = {}) {
  await page.goto("/tasks");
  await main(page).getByRole("button", { name: "Create Task" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Task" });
  await dialog.getByRole("textbox", { name: "Task Title *" }).fill(title);
  if (options.description) {
    await dialog.getByRole("textbox", { name: "Description" }).fill(options.description);
  }
  await dialog.getByRole("textbox", { name: "Assign To *" }).fill("chidi");
  await dialog.getByRole("button", { name: `${USERS.clerk.name} (${USERS.clerk.email})` }).click();
  if (options.priority) {
    await dialog.getByRole("combobox", { name: "Priority" }).selectOption(options.priority);
  }
  await dialog.getByRole("textbox", { name: "Deadline" }).fill(dateTimeFromNow(3));
  await dialog.getByRole("button", { name: "Create Task" }).click();
  await expect(dialog).toBeHidden();
}

async function openTask(page: Page, view: "assigned" | "created", title: string) {
  await page.goto(`/tasks?view=${view}`);
  await taskCards(page).filter({ hasText: title }).click();
  await expect(main(page).getByRole("heading", { level: 1, name: title })).toBeVisible();
}

/** Submitting asks the assignee to confirm in a dialog first. */
async function submitForApproval(page: Page) {
  await main(page).getByRole("button", { name: "Submit for Approval" }).click();
  const dialog = page.getByRole("dialog", { name: "Submit Task for Approval" });
  await dialog.getByRole("button", { name: "Submit for Approval" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("creating a task", () => {
  test.use({ role: "finance" });

  test("requires a title, an assignee and a deadline", async ({ page }) => {
    await page.goto("/tasks");
    await main(page).getByRole("button", { name: "Create Task" }).click();
    const dialog = page.getByRole("dialog", { name: "Create Task" });
    await dialog.getByRole("button", { name: "Create Task" }).click();
    await expect(dialog.getByText("Task title is required.")).toBeVisible();
    await expect(dialog.getByText("Please select at least one user to assign this task to.")).toBeVisible();
    await expect(dialog.getByText("Deadline is required.")).toBeVisible();
  });

  test("does not offer the user themselves or deactivated users as assignees", async ({ page }) => {
    await page.goto("/tasks");
    await main(page).getByRole("button", { name: "Create Task" }).click();
    const dialog = page.getByRole("dialog", { name: "Create Task" });
    const assignee = dialog.getByRole("textbox", { name: "Assign To *" });

    await assignee.fill("chidi");
    await expect(dialog.getByRole("button", { name: /Chidi Clerk/ })).toBeVisible();
    await assignee.fill("femi");
    await expect(dialog.getByRole("button", { name: /Femi Finance/ })).toHaveCount(0);
    await assignee.fill("fola");
    await expect(dialog.getByRole("button", { name: /Fola Former/ })).toHaveCount(0);
  });

  test("adds the new task to Created by Me and to the assignee's list", async ({ page, browser }) => {
    const title = unique("Reconcile petty cash");
    await createTask(page, title, { priority: "high", description: "Count the float and match receipts." });

    await page.goto("/tasks?view=created");
    const card = taskCards(page).filter({ hasText: title });
    await expect(card).toContainText("Pending");
    await expect(card).toContainText("High");
    await expect(card).toContainText("Chidi Clerk");

    const clerk = await pageAs(browser, "clerk");
    await clerk.goto("/tasks");
    await expect(taskCards(clerk).filter({ hasText: title })).toContainText("by Femi");
    await clerk.context().close();
  });

  test("notifies the assignee", async ({ page, browser }) => {
    const title = unique("File VAT return");
    await createTask(page, title);

    const clerk = await pageAs(browser, "clerk");
    await clerk.goto("/dashboard");
    await clerk.getByRole("button", { name: "Open notifications" }).click();
    await expect(clerk.getByText(`You were assigned: ${title} by Femi Finance`)).toBeVisible();
    await clerk.context().close();
  });
});

test.describe("working a task from start to approval", () => {
  test.use({ role: "finance" });

  test("assignee starts, comments and submits; assigner sends it back, then approves", async ({ page, browser }) => {
    const title = unique("Prepare audit pack");
    await createTask(page, title);

    // The assigner cannot move the task forward; only the assignee can.
    await openTask(page, "created", title);
    await expect(main(page).getByRole("button", { name: "Edit Task" })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Start Task (In Progress)" })).toHaveCount(0);

    const clerk = await pageAs(browser, "clerk");
    await openTask(clerk, "assigned", title);
    await expect(main(clerk).getByRole("button", { name: "Edit Task" })).toHaveCount(0);
    await main(clerk).getByRole("button", { name: "Start Task (In Progress)" }).click();
    await expect(main(clerk).getByText("Work is actively in progress by the assignee.")).toBeVisible();
    await expectSequence(main(clerk), "Chidi Clerk", "changed status from", "pending", "to", "in progress");

    const comment = "Ledgers attached, bank statements to follow.";
    await main(clerk).getByRole("textbox", { name: /Share an update/ }).fill(comment);
    await main(clerk).getByRole("button", { name: "Post Comment" }).click();
    await expect(main(clerk).getByText(comment)).toBeVisible();
    await expect(main(clerk).getByRole("textbox", { name: /Share an update/ })).toHaveValue("");

    await submitForApproval(clerk);
    await expect(main(clerk).getByText("Submitted for approval. Awaiting review from assigner.")).toBeVisible();
    await expect(
      main(clerk).getByText("You submitted this task for review. Femi Finance will approve or request changes."),
    ).toBeVisible();

    // Assigner asks for changes.
    await page.reload();
    await expect(main(page).getByText("Chidi Clerk has submitted this task for your final review.")).toBeVisible();
    await expect(main(page).getByText(comment)).toBeVisible();
    await main(page).getByRole("button", { name: "Request Changes" }).click();
    const revisions = page.getByRole("dialog", { name: "Request Revisions" });
    await revisions.getByRole("textbox", { name: "Feedback / Revision Notes" }).fill("Add the March statement.");
    await revisions.getByRole("button", { name: "Send Back for Revision" }).click();
    await expect(revisions).toBeHidden();
    await expect(main(page).getByText("Work is actively in progress by the assignee.")).toBeVisible();
    await expectSequence(main(page), "Femi Finance", "changed status from", "under review", "to", "in progress");

    // Assignee resubmits, assigner approves.
    await clerk.reload();
    await submitForApproval(clerk);
    await expect(main(clerk).getByText("Submitted for approval. Awaiting review from assigner.")).toBeVisible();
    await clerk.context().close();

    await page.reload();
    await main(page).getByRole("button", { name: "Approve" }).click();
    const approval = page.getByRole("dialog", { name: "Approve Task Completion" });
    await approval.getByRole("button", { name: "Confirm Approval" }).click();
    await expect(approval).toBeHidden();
    await expectSequence(main(page), "Femi Finance", "changed status from", "under review", "to", "completed");
    await expect(main(page).getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: "Edit Task" })).toHaveCount(0);

    await page.goto("/tasks?view=created");
    await expect(taskCards(page).filter({ hasText: title })).toContainText("Completed");
  });
});

test.describe("commenting on a task", () => {
  test.use({ role: "finance" });

  test("limits a comment to 500 characters and keeps the button off while empty", async ({ page }) => {
    const title = unique("Chase overdue invoices");
    await createTask(page, title);
    await openTask(page, "created", title);

    const box = main(page).getByRole("textbox", { name: /Share an update/ });
    await expect(main(page).getByRole("button", { name: "Post Comment" })).toBeDisabled();
    await box.fill("x".repeat(520));
    await expect(main(page).getByText("500/500")).toBeVisible();
    await expect(box).toHaveValue("x".repeat(500));
  });

  test("attaches a link to a comment", async ({ page }) => {
    const title = unique("Update supplier list");
    await createTask(page, title);
    await openTask(page, "created", title);

    await main(page).getByRole("textbox", { name: /Share an update/ }).fill("Latest version is here.");
    await main(page).getByRole("button", { name: "Attach Link" }).click();
    await page.getByPlaceholder(/https?:\/\//).first().fill("https://example.com/suppliers");
    await page.getByRole("button", { name: /^Add( Link)?$/ }).click();
    await main(page).getByRole("button", { name: "Post Comment" }).click();

    await expect(main(page).getByText("Latest version is here.")).toBeVisible();
    await expect(main(page).getByRole("link", { name: /example\.com\/suppliers|suppliers/ })).toHaveAttribute(
      "href", "https://example.com/suppliers",
    );
  });
});

test.describe("editing a task", () => {
  test.use({ role: "finance" });

  test("the assigner changes title, priority and deadline, and the change is logged", async ({ page }) => {
    const title = unique("Draft budget memo");
    const renamed = `${title} (revised)`;
    await createTask(page, title);
    await openTask(page, "created", title);

    await main(page).getByRole("button", { name: "Edit Task" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Task Details" });
    await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue(title);
    await dialog.getByRole("textbox", { name: "Title" }).fill(renamed);
    await dialog.getByRole("combobox", { name: "Priority" }).selectOption("low");
    await dialog.getByRole("button", { name: "+1 Week" }).click();
    await dialog.getByRole("textbox", { name: /Reason/ }).fill("Board meeting moved.");
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(dialog).toBeHidden();

    await expect(main(page).getByRole("heading", { level: 1, name: renamed })).toBeVisible();
    await expect(main(page).getByText("Low Priority")).toBeVisible();
    await expectSequence(main(page), "Femi Finance", "updated task details");
  });
});
