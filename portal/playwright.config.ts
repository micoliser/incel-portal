import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8100);

export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}/api/v1`;

// Set E2E_SKIP_BUILD=1 to reuse the last production build of the portal.
// Set E2E_REUSE_SERVERS=1 to run against servers that are already up (handy
// while writing tests). The database is then NOT reseeded between runs.
const reuseExistingServer = Boolean(process.env.E2E_REUSE_SERVERS);
const webCommand = process.env.E2E_SKIP_BUILD
  ? `npx next start -p ${WEB_PORT}`
  : `npx next build && npx next start -p ${WEB_PORT}`;

export default defineConfig({
  testDir: "./e2e/tests",
  outputDir: "./e2e/.results",
  // The suite shares one seeded database, so tests run one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "e2e/.report", open: "never" }]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
    timezoneId: "UTC",
    locale: "en-GB",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: process.env.E2E_CHROMIUM_PATH
          ? { executablePath: process.env.E2E_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: [
    {
      command: "bash e2e/scripts/api-server.sh",
      url: `http://127.0.0.1:${API_PORT}/health/`,
      reuseExistingServer,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: webCommand,
      url: WEB_URL,
      reuseExistingServer,
      timeout: 600_000,
      env: { NEXT_PUBLIC_API_BASE_URL: API_URL },
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
