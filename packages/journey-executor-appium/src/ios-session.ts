import type { IosAppiumSessionFactory } from "./ios-contracts.js";

/** WebdriverIO and raw XCUITest protocol commands remain inside this imperative port. */
export const createIosWebdriverIoSession: IosAppiumSessionFactory = async (options) => {
  const { remote } = await import("webdriverio");
  const client = await remote({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 4725,
    path: options.path ?? "/",
    protocol: options.protocol ?? "http",
    logLevel: "error",
    connectionRetryCount: 0,
    connectionRetryTimeout: 180_000,
    capabilities: { platformName: "iOS", "appium:automationName": "XCUITest", ...options.capabilities }
  });
  return {
    id: client.sessionId,
    async findElements(xpath) {
      const found = await client.findElements("xpath", xpath);
      return Object.freeze(found.map((item) => Object.freeze({ elementId: item["element-6066-11e4-a52e-4f735466cecf"] })));
    },
    async tap(id) {
      let previous = await client.getElementRect(id).catch(() => undefined);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const [current, hittable] = await Promise.all([
          client.getElementRect(id).catch(() => undefined),
          client.getElementAttribute(id, "hittable").catch(() => undefined)
        ]);
        const stable =
          !previous ||
          !current ||
          (current.x === previous.x &&
            current.y === previous.y &&
            current.width === previous.width &&
            current.height === previous.height);
        previous = current;
        if (stable && (hittable === undefined || hittable === null || hittable === "true")) break;
      }
      await client.elementClick(id);
    },
    async swipeDown(id) {
      const [rect, window] = await Promise.all([client.getElementRect(id), client.getWindowRect()]);
      const x = Math.round(rect.x + rect.width / 2);
      const fromY = Math.round(rect.y + rect.height / 2);
      // Drag far enough to cross UIRefreshControl's threshold while staying clear of the bottom tab bar.
      const toY = Math.round(Math.min(fromY + window.height * 0.35, window.height * 0.8));
      if (toY - fromY < 100) {
        throw new Error("iOS swipe down requires at least 100 points of vertical room below the target element");
      }
      // Begin moving immediately after pointerDown so XCUITest does not interpret the press as a long press.
      await client.performActions([{
        type: "pointer",
        id: "finger",
        parameters: { pointerType: "touch" },
        actions: [
          { type: "pointerMove", duration: 0, x, y: fromY },
          { type: "pointerDown", button: 0 },
          { type: "pointerMove", duration: 600, x, y: toY },
          { type: "pointerUp", button: 0 }
        ]
      }]);
      await client.releaseActions();
    },
    async setValue(id, value) {
      const placeholder = await client.getElementAttribute(id, "placeholderValue").catch(() => undefined);
      const isFilled = (actual: string | null | undefined): boolean =>
        actual !== undefined &&
        actual !== null &&
        actual !== "" &&
        (actual === value || !placeholder || actual !== placeholder);
      await client.elementClick(id);
      await new Promise((resolve) => setTimeout(resolve, 250));
      await client.elementClear(id);
      await client.elementSendKeys(id, value);
      if (value.length > 0) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const actual = await client.getElementAttribute(id, "value").catch(() => undefined);
          if (isFilled(actual)) return;
          await new Promise((resolve) => setTimeout(resolve, 400));
          await client.elementClick(id);
          await new Promise((resolve) => setTimeout(resolve, 250));
          await client.elementSendKeys(id, value);
        }
        const finalValue = await client.getElementAttribute(id, "value").catch(() => undefined);
        if (!isFilled(finalValue)) {
          throw new Error("iOS text entry left target field empty after focus and retry");
        }
      }
    },
    source: () => client.getPageSource(),
    screenshot: () => client.takeScreenshot(),
    async deviceMetrics() {
      const screenInfo = await client.execute("mobile: deviceScreenInfo").catch(() => undefined) as { scale?: number } | undefined;
      const scale = screenInfo?.scale;
      const platformVersion = (client.capabilities as Record<string, unknown>).platformVersion;
      return Object.freeze({
        ...(typeof scale === "number" && Number.isFinite(scale) && scale > 0 ? { scale } : {}),
        ...(typeof platformVersion === "string" ? { platformVersion } : {})
      });
    },
    async activateApplication(bundleId) { await client.execute("mobile: activateApp", { bundleId }); },
    async terminateApplication(bundleId) { await client.execute("mobile: terminateApp", { bundleId }); },
    async openDeepLink(url, bundleId) { await client.execute("mobile: deepLink", { url, bundleId }); },
    async close() {
      try { await client.deleteSession(); }
      catch (error) {
        if (!/terminated or not started|invalid session id/i.test(String(error))) throw error;
      }
    }
  };
};
