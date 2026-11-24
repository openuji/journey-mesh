import { chromium, firefox, webkit, type LaunchOptions, type BrowserContextOptions } from "playwright";
import { booleanOption, defineExecutorPlugin, knownOptions, optionsObject, positiveNumber } from "@openuji/journey-plugin";
import { webClientContract } from "@openuji/journey-platform-web";
import { playwrightObservationContract } from "./observation-contract.js";
import { playwrightExecutor, playwrightDiscoveryExecutor } from "./index.js";
import { parsePlaywrightKeyboard } from "./keyboard.js";
import { parsePlaywrightTransientUi } from "./transient.js";

const browsers = { chromium, firefox, webkit };

export const journeyMeshPlugin = defineExecutorPlugin({
  kind: "executor", observationContract: playwrightObservationContract, clientContract: webClientContract,
  parse(options) {
    knownOptions(options, ["browser", "headless", "launchOptions", "contextOptions", "assertionTimeoutMs", "actionTimeoutMs", "navigationTimeoutMs", "keyboard", "transientUi"]);
    const browser = String(options.browser ?? "chromium");
    if (!Object.hasOwn(browsers, browser)) throw new Error("Unknown browser");
    return {
      browser: browser as keyof typeof browsers,
      headless: booleanOption(options.headless, true),
      launchOptions: options.launchOptions === undefined ? undefined : optionsObject(options.launchOptions, "launchOptions") as LaunchOptions,
      contextOptions: options.contextOptions === undefined ? undefined : optionsObject(options.contextOptions, "contextOptions") as BrowserContextOptions,
      assertionTimeoutMs: positiveNumber(options.assertionTimeoutMs, 30_000),
      actionTimeoutMs: positiveNumber(options.actionTimeoutMs, 30_000),
      navigationTimeoutMs: positiveNumber(options.navigationTimeoutMs, 30_000),
      keyboard: parsePlaywrightKeyboard(options.keyboard),
      transientUi: parsePlaywrightTransientUi(options.transientUi)
    };
  },
  validateOperations(settings, context, { client }) {
    if (!client) throw new Error("Playwright requires a client");
    const executor = playwrightExecutor({ client, keyboard: settings.keyboard });
    for (const operation of context.operations) executor.describeOperation?.(operation);
  },
  create({ browser, ...settings }, _context, { client, observers }) {
    if (!client) throw new Error("Playwright requires a client");
    return playwrightExecutor({ ...settings, client, executionObservers: observers, browserType: browsers[browser] });
  },
  /**
   * `journey-mesh discover` builds this instead of `create`, with the same settings, so a suite's
   * browser, viewport, keyboard table and transientUi apply unchanged. Web only: it walks the
   * browser's focus order. Findings go to the host's port, never to a file of the executor's own.
   */
  discovery: {
    create({ browser, ...settings }, _context, { client }, { rediscover, findings }) {
      if (!client) throw new Error("Playwright requires a client");
      return playwrightDiscoveryExecutor({ ...settings, client, browserType: browsers[browser] }, { rediscover, record: (finding) => findings.record(finding) });
    }
  }
});
