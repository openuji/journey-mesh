import type { AppiumSessionFactory } from "./contracts.js";

/** WebdriverIO is loaded only when allocating a real session. */
export const createWebdriverIoSession: AppiumSessionFactory = async (options) => {
  const { remote } = await import("webdriverio");
  const client = await remote({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 4723,
    path: options.path ?? "/",
    protocol: options.protocol ?? "http",
    logLevel: "error",
    connectionRetryCount: 0,
    connectionRetryTimeout: 120_000,
    capabilities: { platformName: "Android", "appium:automationName": "UiAutomator2", ...options.capabilities }
  });
  return {
    id: client.sessionId,
    async findElements(xpath) {
      const found = await client.findElements("xpath", xpath);
      return Object.freeze(found.map((item) => Object.freeze({ elementId: item["element-6066-11e4-a52e-4f735466cecf"] })));
    },
    async tap(id) { await client.elementClick(id); },
    async setValue(id, value) { await client.elementClear(id); await client.elementSendKeys(id, value); },
    source: () => client.getPageSource(),
    screenshot: () => client.takeScreenshot(),
    async deviceMetrics() {
      const densityDpi = await client.getDisplayDensity();
      const platformVersion = (client.capabilities as Record<string, unknown>).platformVersion;
      return Object.freeze({
        ...(Number.isFinite(densityDpi) && densityDpi > 0 ? { densityDpi } : {}),
        ...(typeof platformVersion === "string" ? { platformVersion } : {})
      });
    },
    execute: (command, args) => client.execute(command, args),
    async close() { await client.deleteSession(); }
  };
};
