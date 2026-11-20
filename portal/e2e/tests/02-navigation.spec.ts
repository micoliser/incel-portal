import { USERS, type Role } from "../support/seed";
import { expect, test } from "../support/fixtures";
import { header, main, sidebar } from "../support/ui";

const COMMON_LINKS = [
  "Dashboard", "Tasks", "My To-Dos", "Goals", "Chat", "Reports", "Summaries", "Applications", "My Assets", "Support",
];
const ADMIN_LINKS = [...COMMON_LINKS, "Users", "Departments", "Inventory", "Organization", "Logs"];

const NAVIGATION: Array<{ role: Role; links: string[] }> = [
  { role: "staff", links: COMMON_LINKS },
  { role: "manager", links: COMMON_LINKS },
  { role: "itmanager", links: [...COMMON_LINKS, "Inventory"] },
  { role: "itstaff", links: [...COMMON_LINKS, "Inventory"] },
  { role: "director", links: ADMIN_LINKS },
  { role: "admin", links: ADMIN_LINKS },
];

for (const { role, links } of NAVIGATION) {
  test.describe(`sidebar for ${role}`, () => {
    test.use({ role });

    test("lists exactly the sections this role may open", async ({ page }) => {
      await page.goto("/dashboard");
      const nav = sidebar(page).getByRole("navigation");
      await expect(nav.getByRole("link")).toHaveText(links);
    });

    test("shows the user's name, title and department in the header", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(header(page).getByText(USERS[role].name)).toBeVisible();
      await expect(header(page).getByText(USERS[role].roleLabel, { exact: true })).toBeVisible();
    });
  });
}

test.describe("header titles", () => {
  test.use({ role: "supervisor" });
  test("names a unit supervisor as Supervisor", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(header(page).getByText("Supervisor", { exact: true })).toBeVisible();
  });
});

test.describe("header titles for a team lead", () => {
  test.use({ role: "lead" });
  test("names a team lead as Team Lead", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(header(page).getByText("Team Lead", { exact: true })).toBeVisible();
  });
});

test.describe("pages a staff member may not open", () => {
  test.use({ role: "staff" });

  for (const path of ["/users", "/departments", "/inventory", "/inventory/maintenance", "/logs", "/organization-summary"]) {
    test(`${path} sends them back to the dashboard`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL("/dashboard");
      await expect(main(page).getByRole("heading", { name: "Task Overview" })).toBeVisible();
    });
  }
});

test.describe("sidebar links", () => {
  test.use({ role: "staff" });

  const DESTINATIONS: Array<[string, string, string]> = [
    ["Tasks", "/tasks", "Tasks"],
    ["My To-Dos", "/todos", "My To-Dos"],
    ["Goals", "/goals", "Goals"],
    ["Chat", "/chat", "Chat"],
    ["Reports", "/reports", "Reports"],
    ["Summaries", "/summaries", "Summaries"],
    ["Applications", "/applications", "Applications"],
    ["My Assets", "/my-assets", "My Assets"],
    ["Support", "/support", "Support"],
  ];

  for (const [link, url] of DESTINATIONS) {
    test(`"${link}" opens ${url}`, async ({ page }) => {
      await page.goto("/dashboard");
      await sidebar(page).getByRole("link", { name: link, exact: true }).click();
      await expect(page).toHaveURL(url);
    });
  }
});
