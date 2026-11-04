import { knownOptions, positiveNumber, type JourneyMeshPlugin } from "@openuji/journey-runtime/plugin";
import { appiumAdapter, type AppiumJourneyDriver, type AppiumExecutionObserver } from "./index.js";
import type { JourneyAdapter } from "@openuji/journey-runner";
function endpoint(value: unknown): URL {
  if (typeof value !== "string") throw new Error("Appium endpoint must be an HTTP(S) URL");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Appium endpoint must be an HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Appium endpoint must be an HTTP(S) URL without credentials, query or fragment");
  return url;
}
export const journeyMeshPlugin: JourneyMeshPlugin<JourneyAdapter> = {
  apiVersion: 1, kind: "adapter", runtime: "appium",
  validate(options) {
    knownOptions(options, ["endpoint", "assertionTimeoutMs", "pollIntervalMs"]);
    endpoint(options.endpoint ?? "http://127.0.0.1:4723/");
    positiveNumber(options.assertionTimeoutMs, 60_000); positiveNumber(options.pollIntervalMs, 200);
  },
  create(options, _context, dependencies) {
    if (!dependencies.driver) throw new Error("Appium requires a driver");
    const url = endpoint(options.endpoint ?? "http://127.0.0.1:4723/");
    return appiumAdapter({
      driver: dependencies.driver as AppiumJourneyDriver, executionObservers: dependencies.observers as AppiumExecutionObserver[],
      connection: { hostname: url.hostname, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)), protocol: url.protocol === "https:" ? "https" : "http", path: url.pathname },
      assertionTimeoutMs: positiveNumber(options.assertionTimeoutMs, 60_000), pollIntervalMs: positiveNumber(options.pollIntervalMs, 200)
    });
  }
};
