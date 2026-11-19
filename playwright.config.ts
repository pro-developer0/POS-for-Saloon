import { defineConfig, devices } from "@playwright/test";

// E2E runs against its own throw-away database (.data/e2e) on port 3200 — it never touches your dev data.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 }, // dev server compiles pages/actions on first use
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3200", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx tsx scripts/seed.ts --reset && npx next dev -p 3200",
    url: "http://localhost:3200/login",
    timeout: 240_000,
    reuseExistingServer: false,
    env: { PGLITE_DIR: ".data/e2e", OUTBOX_FILE: ".data/e2e-outbox.log", AUTH_SECRET: "e2e-secret-0123456789-abcdefghijklmnopqrstuv" },
  },
});
