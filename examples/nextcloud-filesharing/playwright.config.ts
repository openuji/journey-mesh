import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "run.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  outputDir: "test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }]
  ],
  use: {
    browserName: "chromium",
    actionTimeout: 30_000,
    navigationTimeout: 30_000
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
