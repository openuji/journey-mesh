import { defineConfig, devices } from "@playwright/test";

const defaultTimeoutMs = 180_000;
const configuredTimeoutMs = Number(process.env.UJG_EXAMPLE_TIMEOUT_MS ?? defaultTimeoutMs);

export default defineConfig({
  testDir: ".",
  testMatch: "run.ts",
  fullyParallel: false,
  workers: 1,
  timeout: Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : defaultTimeoutMs,
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
