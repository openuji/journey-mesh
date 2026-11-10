import { androidDriverContract, type AndroidJourneyDriver } from "@openuji/journey-driver-android";
import {
  knownOptions, optionsObject, positiveNumber, requiredString, type JourneyMeshPlugin
} from "@openuji/journey-runtime/plugin";
import type { JourneyAdapter } from "@openuji/journey-runner";
import { ensureApk } from "./application.js";
import { appiumAdapter, type AppiumDeviceConfig, type AppiumExecutionObserver } from "./index.js";

type ApplicationConfig = Readonly<{ apk: string; url: string; sha256: string; package: string; activity: string }>;

function applicationConfig(options: Record<string, unknown>): ApplicationConfig {
  const application = optionsObject(options.application, "application");
  return Object.freeze({
    apk: requiredString(application.apk, "application.apk"),
    url: requiredString(application.url, "application.url"),
    sha256: requiredString(application.sha256, "application.sha256"),
    package: requiredString(application.package, "application.package"),
    activity: requiredString(application.activity, "application.activity")
  });
}

function endpoint(value: unknown): URL {
  if (typeof value !== "string") throw new Error("Appium endpoint must be an HTTP(S) URL");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Appium endpoint must be an HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Appium endpoint must be an HTTP(S) URL without credentials, query or fragment");
  }
  return url;
}

async function configuration(options: Record<string, unknown>, resolvePath: (path: string) => string) {
  const application = applicationConfig(options);
  const apk = resolvePath(typeof options.apk === "string" && options.apk
    ? options.apk
    : `${requiredString(options.apkDirectory, "apkDirectory")}/${application.apk}`);
  await ensureApk({ path: apk, url: application.url, sha256: application.sha256 });
  const devices = Object.fromEntries(Object.entries(optionsObject(options.devices, "devices")).map(([id, raw]) => {
    const device = optionsObject(raw, `device ${id}`);
    return [id, Object.freeze({
      udid: requiredString(device.udid, `device ${id}.udid`),
      capabilities: optionsObject(device.capabilities ?? {}, `device ${id}.capabilities`)
    }) satisfies AppiumDeviceConfig];
  }));
  return Object.freeze({ application, apk, devices: Object.freeze(devices) });
}

export const journeyMeshPlugin: JourneyMeshPlugin<JourneyAdapter> = {
  apiVersion: 1,
  kind: "adapter",
  runtime: "appium",
  driverContract: androidDriverContract,
  async validate(options, context) {
    knownOptions(options, ["endpoint", "assertionTimeoutMs", "pollIntervalMs", "application", "apkDirectory", "apk", "devices"]);
    endpoint(options.endpoint ?? "http://127.0.0.1:4723/");
    positiveNumber(options.assertionTimeoutMs, 60_000);
    positiveNumber(options.pollIntervalMs, 200);
    const configured = await configuration(options, context.resolvePath);
    for (const operation of context.operations) {
      if (!configured.devices[operation.touchpointId]) throw new Error(`Missing device for touchpoint ${operation.touchpointId}`);
    }
  },
  async create(options, context, dependencies) {
    if (!dependencies.driver) throw new Error("Appium requires a driver");
    const url = endpoint(options.endpoint ?? "http://127.0.0.1:4723/");
    const configured = await configuration(options, context.resolvePath);
    return appiumAdapter({
      driver: dependencies.driver as AndroidJourneyDriver,
      application: { apk: configured.apk, package: configured.application.package, activity: configured.application.activity },
      devices: configured.devices,
      executionObservers: dependencies.observers as readonly AppiumExecutionObserver[],
      connection: { hostname: url.hostname, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)), protocol: url.protocol === "https:" ? "https" : "http", path: url.pathname },
      assertionTimeoutMs: positiveNumber(options.assertionTimeoutMs, 60_000),
      pollIntervalMs: positiveNumber(options.pollIntervalMs, 200)
    });
  }
};
