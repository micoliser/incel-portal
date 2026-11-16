import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import { choose, expectSequence, main } from "../support/ui";

/** The block for one department: from its heading down to its units. */
function departmentBlock(page: Page, name: string): Locator {
  return main(page)
    .locator("div")
    .filter({ has: page.getByRole("heading", { level: 2, name, exact: true }) })
    .filter({ has: page.getByRole("button", { name: /^Members/ }) })
    .last();
}

function shortCode(prefix: string) {
  return `${prefix}${Date.now().toString(36).slice(-5).toUpperCase()}`;
}

async function createDepartment(page: Page, name: string, code: string) {
  await page.goto("/departments");
  await main(page).getByRole("button", { name: "Add Department" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Department" });
  await dialog.getByRole("textbox", { name: "Department Name" }).fill(name);
  await dialog.getByRole("textbox", { name: "Department Code" }).fill(code);
  await dialog.getByRole("button", { name: "Create Department" }).click();
  await expect(dialog).toBeHidden();
  await expect(main(page).getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
}

test.describe("organization structure for an administrator", () => {
  test.use({ role: "admin" });

  test("counts departments, units, teams and appointed leaders", async ({ page }) => {
    await page.goto("/departments");
    const body = main(page);
    await expect(body.getByRole("heading", { level: 1, name: "Organization Structure" })).toBeVisible();
    await expectSequence(body, "Departments", 4);
    await expectSequence(body, "Business Units", 2);
    await expectSequence(body, "Functional Teams", 1);
    await expectSequence(body, "Assigned Leaders", 5);
    await expect(body.getByRole("heading", { level: 2 })).toHaveText(["Finance", "Human Resources", "IT", "Operations"]);
  });

  test("shows each department's code, size and line manager", async ({ page }) => {
    await page.goto("/departments");
    const body = main(page);
    await expectSequence(body, "Operations", "OPS", "2 Units", "6 Members", "Manager:", "Mary Manager");
    await expectSequence(body, "IT", "IT", "0 Units", "2 Members", "Manager:", "Ife Itmanager");
    await expect(departmentBlock(page, "Finance").getByRole("button", { name: "Assign Manager" })).toBeVisible();
    await expect(departmentBlock(page, "Operations").getByRole("button", { name: "Edit Line Manager" })).toBeVisible();
  });

  test("shows units with their supervisors and, when expanded, their teams", async ({ page }) => {
    await page.goto("/departments");
    const body = main(page);
    await expectSequence(body, "Logistics", "OPS-LOG", "1 Team", "4 Members", "Supervisor:", "Sam Supervisor");
    await expectSequence(body, "Warehouse", "OPS-WH", "0 Teams", "1 Member");
    await body.getByRole("button", { name: "Expand All" }).click();
    await expectSequence(body, "Dispatch", "OPS-LOG-DSP", "3 Members", "Lead:", "Lola Lead");
  });

  test("lists a department's members", async ({ page }) => {
    await page.goto("/departments");
    await departmentBlock(page, "IT").getByRole("button", { name: "Members 2" }).click();
    const dialog = page.getByRole("dialog", { name: "IT Members" });
    await expect(dialog.getByText("Ife Itmanager")).toBeVisible();
    await expect(dialog.getByText("Tolu Technician")).toBeVisible();
    await expect(dialog.getByText("2 total members")).toBeVisible();
  });

  test("searches the structure", async ({ page }) => {
    await page.goto("/departments");
    const body = main(page);
    await body.getByRole("textbox", { name: "Search departments, units, teams..." }).fill("warehouse");
    await expect(body.getByRole("heading", { level: 2 })).toHaveText(["Operations"]);
    await expect(body.getByRole("heading", { name: "Warehouse" })).toBeVisible();
  });
});

test.describe("organization structure for an executive", () => {
  test.use({ role: "director" });

  test("is visible but cannot be changed", async ({ page }) => {
    await page.goto("/departments");
    const body = main(page);
    await expect(body.getByRole("heading", { level: 2, name: "Operations" })).toBeVisible();
    await expect(body.getByRole("button", { name: "Add Department" })).toHaveCount(0);
    await expect(body.getByRole("button", { name: "Add Unit" })).toHaveCount(0);
    await expect(body.getByRole("button", { name: "Edit Line Manager" })).toHaveCount(0);
  });
});

test.describe("changing the organization structure", () => {
  test.use({ role: "admin" });

  test("adds a department, then a unit and a team inside it", async ({ page }) => {
    const department = `Research ${shortCode("")}`;
    await createDepartment(page, department, shortCode("RS"));
    const block = departmentBlock(page, department);
    await expect(block).toContainText("0 Units");
    await expect(block).toContainText("0 Members");

    await block.getByRole("button", { name: "Add Unit" }).first().click();
    const unitDialog = page.getByRole("dialog", { name: "Create Unit" });
    await unitDialog.getByRole("textbox", { name: "Unit Name" }).fill("Field Studies");
    await unitDialog.getByRole("textbox", { name: "Unit Code" }).fill(shortCode("FS"));
    await unitDialog.getByRole("button", { name: "Create Unit" }).click();
    await expect(unitDialog).toBeHidden();
    await expect(departmentBlock(page, department)).toContainText("1 Unit");
    const unit = main(page)
      .locator("div")
      .filter({ has: page.getByRole("heading", { name: "Field Studies", exact: true }) })
      .filter({ has: page.getByRole("button", { name: "Add Team" }) })
      .last();
    await expect(unit).toContainText("0 Teams");

    await unit.getByRole("button", { name: "Add Team" }).click();
    const teamDialog = page.getByRole("dialog", { name: "Create Team" });
    await teamDialog.getByRole("textbox", { name: "Team Name" }).fill("Survey Crew");
    await teamDialog.getByRole("textbox", { name: "Team Code" }).fill(shortCode("SC"));
    await teamDialog.getByRole("button", { name: "Create Team" }).click();
    await expect(teamDialog).toBeHidden();
    await main(page).getByRole("button", { name: "Expand All" }).click();
    await expect(main(page).getByText("Survey Crew")).toBeVisible();
  });

  test("rejects a department code that is already used", async ({ page }) => {
    await page.goto("/departments");
    await main(page).getByRole("button", { name: "Add Department" }).click();
    const dialog = page.getByRole("dialog", { name: "Create Department" });
    await dialog.getByRole("textbox", { name: "Department Name" }).fill(`Duplicate ${shortCode("")}`);
    await dialog.getByRole("textbox", { name: "Department Code" }).fill("OPS");
    await dialog.getByRole("button", { name: "Create Department" }).click();
    await expect(page.getByText(/already exists/i).first()).toBeVisible();
  });

  test("moves a person into a department and appoints them line manager", async ({ page }) => {
    const department = `Compliance ${shortCode("")}`;
    await createDepartment(page, department, shortCode("CP"));

    await departmentBlock(page, department).getByRole("button", { name: /^Members/ }).click();
    const members = page.getByRole("dialog", { name: `${department} Members` });
    await members.getByRole("button", { name: "Add", exact: true }).click();
    const adding = page.getByRole("dialog", { name: `Add Members to ${department}` });
    await adding.getByRole("searchbox", { name: "Search candidate users..." }).fill("changer");
    await adding.getByText("Chika Changer").click();
    await expect(adding.getByText("1 selected")).toBeVisible();
    await adding.getByRole("button", { name: "Add (1)" }).click();

    // Moving someone out of another department needs an explicit confirmation.
    const confirm = page.getByRole("dialog", { name: "Confirm Assignment" });
    await expect(confirm).toContainText("Chika Changer");
    await expect(confirm).toContainText("Finance");
    await confirm.getByRole("button", { name: "Confirm Reassignment" }).click();

    const updated = page.getByRole("dialog", { name: `${department} Members` });
    await expect(updated.getByText("Chika Changer")).toBeVisible();
    await expect(updated.getByText(/1 total member/)).toBeVisible();
    await updated.getByRole("button", { name: "Done" }).click();
    await expect(departmentBlock(page, department)).toContainText("1 Member");

    await departmentBlock(page, department).getByRole("button", { name: "Assign Manager" }).click();
    const leader = page.getByRole("dialog", { name: "Assign Line Manager" });
    await choose(page, leader.getByRole("combobox"), /Chika Changer/, "chika");
    await leader.getByRole("button", { name: "Save changes" }).click();
    await expect(leader).toBeHidden();
    await expectSequence(departmentBlock(page, department), "Manager:", "Chika Changer");
  });
});
