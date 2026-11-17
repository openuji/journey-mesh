import { androidDriverContract } from "@openuji/journey-driver-android";
import { defineAdapterPlugin, knownOptions, optionsObject, positiveNumber, requiredString } from "@openuji/journey-plugin";
import { ensureApk } from "./application.js";
import { appiumAutomation } from "./automation.js";
import { appiumAdapter, type AppiumDeviceConfig } from "./index.js";

function endpoint(value: unknown): URL {
  if (typeof value !== "string") throw new Error("Appium endpoint must be an HTTP(S) URL");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Appium endpoint must be an HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Appium endpoint must be an HTTP(S) URL without credentials, query or fragment");
  }
  return url;
}

export const journeyMeshPlugin = defineAdapterPlugin({
  kind: "adapter", automation: appiumAutomation, driverContract: androidDriverContract,
  parse(options, context) {
    knownOptions(options, ["endpoint", "assertionTimeoutMs", "pollIntervalMs", "application", "apkDirectory", "apk", "devices"]);
    const raw = optionsObject(options.application, "application");
    const application = Object.freeze({
      apk: requiredString(raw.apk, "application.apk"), url: requiredString(raw.url, "application.url"), sha256: requiredString(raw.sha256, "application.sha256"),
      package: requiredString(raw.package, "application.package"), activity: requiredString(raw.activity, "application.activity")
    });
    const devices: Record<string, AppiumDeviceConfig> = Object.fromEntries(Object.entries(optionsObject(options.devices, "devices")).map(([id, value]) => {
      const device = optionsObject(value, `device ${id}`);
      return [id, Object.freeze({ udid: requiredString(device.udid, `device ${id}.udid`), capabilities: optionsObject(device.capabilities ?? {}, `device ${id}.capabilities`) })];
    }));
    for (const operation of context.operations) if (!devices[operation.touchpointId]) throw new Error(`Missing device for touchpoint ${operation.touchpointId}`);
    return {
      endpoint: endpoint(options.endpoint ?? "http://127.0.0.1:4723/"), application, devices: Object.freeze(devices),
      apk: context.resolvePath(typeof options.apk === "string" && options.apk ? options.apk : `${requiredString(options.apkDirectory, "apkDirectory")}/${application.apk}`),
      assertionTimeoutMs: positiveNumber(options.assertionTimeoutMs, 60_000),
      pollIntervalMs: positiveNumber(options.pollIntervalMs, 200)
    };
  },
  create({ endpoint: url, application, apk, devices, assertionTimeoutMs, pollIntervalMs }, _context, { driver, observers }) {
    if (!driver) throw new Error("Appium requires a driver");
    return appiumAdapter({
      driver, devices, executionObservers: observers, assertionTimeoutMs, pollIntervalMs,
      application: { apk, package: application.package, activity: application.activity },
      // The pinned APK is downloaded when an execution starts, never during validation.
      prepare: () => ensureApk({ path: apk, url: application.url, sha256: application.sha256 }),
      connection: { hostname: url.hostname, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)), protocol: url.protocol === "https:" ? "https" : "http", path: url.pathname }
    });
  }
});
