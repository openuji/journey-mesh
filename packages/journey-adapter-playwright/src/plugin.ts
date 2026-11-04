import { chromium, firefox, webkit, type LaunchOptions, type BrowserContextOptions } from "playwright";
import { booleanOption, knownOptions, optionsObject, positiveNumber, type JourneyMeshPlugin } from "@openuji/journey-runtime/plugin";
import { playwrightAdapter, type PlaywrightJourneyDriver, type PlaywrightExecutionObserver } from "./index.js";
import type { JourneyAdapter } from "@openuji/journey-runner";
export const journeyMeshPlugin: JourneyMeshPlugin<JourneyAdapter> = {
  apiVersion: 1, kind: "adapter", runtime: "playwright",
  validate(options) {
    knownOptions(options, ["browser", "headless", "launchOptions", "contextOptions", "assertionTimeoutMs", "actionTimeoutMs", "navigationTimeoutMs"]);
    if (options.browser !== undefined && !["chromium", "firefox", "webkit"].includes(String(options.browser))) throw new Error("Unknown browser");
    booleanOption(options.headless, true);
    for (const key of ["assertionTimeoutMs", "actionTimeoutMs", "navigationTimeoutMs"]) positiveNumber(options[key], 30_000);
    if (options.launchOptions !== undefined) optionsObject(options.launchOptions, "launchOptions");
    if (options.contextOptions !== undefined) optionsObject(options.contextOptions, "contextOptions");
  },
  create(options, _context, dependencies) {
    if (!dependencies.driver) throw new Error("Playwright requires a driver");
    return playwrightAdapter({
      driver: dependencies.driver as PlaywrightJourneyDriver,
      executionObservers: dependencies.observers as PlaywrightExecutionObserver[],
      browserType: { chromium, firefox, webkit }[String(options.browser ?? "chromium") as "chromium"],
      headless: booleanOption(options.headless, true), launchOptions: options.launchOptions as LaunchOptions | undefined,
      contextOptions: options.contextOptions as BrowserContextOptions | undefined,
      assertionTimeoutMs: positiveNumber(options.assertionTimeoutMs, 30_000),
      actionTimeoutMs: positiveNumber(options.actionTimeoutMs, 30_000),
      navigationTimeoutMs: positiveNumber(options.navigationTimeoutMs, 30_000)
    });
  }
};
