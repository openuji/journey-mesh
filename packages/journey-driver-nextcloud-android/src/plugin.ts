import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { knownOptions, optionsObject, requiredString, type JourneyMeshPlugin } from "@openuji/journey-runtime/plugin";
import { nextcloudAndroidDriver, openNextcloudAndroidNotifications, type NextcloudAndroidDriverOptions } from "./index.js";
import type { AppiumJourneyDriver, AppiumSessionOptions } from "@openuji/journey-adapter-appium";

type RuntimeManifest = { nextcloud: { apk: string; sha256: string; package: string; activity: string } };
export const journeyMeshPlugin: JourneyMeshPlugin<AppiumJourneyDriver> = {
  apiVersion: 1, kind: "driver", runtime: "appium",
  async validate(options, context) {
    knownOptions(options, ["touchpoints", "users", "entries", "runtimeManifest", "apkDirectory", "apk", "devices"]);
    const runtime = JSON.parse(await readFile(context.resolvePath(requiredString(options.runtimeManifest, "runtimeManifest")), "utf8")) as RuntimeManifest;
    for (const key of ["apk", "sha256", "package", "activity"] as const) requiredString(runtime.nextcloud?.[key], `runtimeManifest.nextcloud.${key}`);
    const apk = context.resolvePath(typeof options.apk === "string" && options.apk ? options.apk : `${requiredString(options.apkDirectory, "apkDirectory")}/${runtime.nextcloud.apk}`);
    const hash = createHash("sha256").update(await readFile(apk)).digest("hex");
    if (hash !== runtime.nextcloud.sha256) throw new Error("Nextcloud APK does not match runtime manifest SHA-256");
    const touchpoints = optionsObject(options.touchpoints, "touchpoints");
    for (const raw of Object.values(touchpoints)) {
      try { new URL(requiredString(optionsObject(raw).baseURL, "baseURL")); } catch { throw new Error("Invalid native service baseURL"); }
    }
    for (const raw of Object.values(optionsObject(options.users, "users"))) {
      const user = optionsObject(raw); requiredString(user.username, "username"); requiredString(user.password, "password");
    }
    for (const value of Object.values(optionsObject(options.entries, "entries"))) if (value !== "notifications") throw new Error("Unknown Nextcloud Android entry handler");
    for (const operation of context.operations) {
      if (!Object.hasOwn(optionsObject(options.users), operation.actorId)) throw new Error(`Missing user for actor ${operation.actorId}`);
      if (!Object.hasOwn(touchpoints, operation.touchpointId) || !Object.hasOwn(optionsObject(options.devices), operation.touchpointId)) throw new Error(`Missing service or device for touchpoint ${operation.touchpointId}`);
      if (operation.entryBinding && !Object.hasOwn(optionsObject(options.entries), operation.entryBinding.value)) throw new Error(`Missing native entry handler for ${operation.entryBinding.value}`);
    }
    for (const [id, raw] of Object.entries(optionsObject(options.devices, "devices"))) {
      if (!touchpoints[id]) throw new Error(`Device references unknown touchpoint ${id}`);
      requiredString(optionsObject(raw).udid, "device udid");
    }
  },
  async create(options, context) {
    const runtime = JSON.parse(await readFile(context.resolvePath(options.runtimeManifest as string), "utf8")) as RuntimeManifest;
    const apk = context.resolvePath(typeof options.apk === "string" && options.apk ? options.apk : `${options.apkDirectory}/${runtime.nextcloud.apk}`);
    const devices: Record<string, AppiumSessionOptions> = {};
    for (const [id, raw] of Object.entries(options.devices as Record<string, Record<string, unknown>>)) {
      devices[id] = { capabilities: {
        ...optionsObject(raw.capabilities ?? {}),
        "appium:udid": raw.udid, "appium:app": apk, "appium:appPackage": runtime.nextcloud.package,
        "appium:appActivity": runtime.nextcloud.activity, "appium:noReset": false, "appium:fullReset": true,
        "appium:autoGrantPermissions": true, "appium:language": "en", "appium:locale": "US", "appium:newCommandTimeout": 180
      } };
    }
    const driver = nextcloudAndroidDriver({
      touchpoints: options.touchpoints, users: options.users, devices,
      entries: Object.fromEntries(Object.keys(options.entries as object).map((id) => [id, openNextcloudAndroidNotifications]))
    } as NextcloudAndroidDriverOptions);
    // Record reproducibility metadata after startup, not during configuration preflight.
    return { ...driver, createExecution(input) {
      const execution = driver.createExecution(input);
      return {
        start: async () => {
          await context.artifacts.write({ name: "android-runtime.json", data: JSON.stringify({ expectedRuntime: runtime, apkSha256: runtime.nextcloud.sha256 }, null, 2), contentType: "application/json" });
          await execution.start();
        },
        openEntry: (operation) => execution.openEntry(operation),
        sessionForOperation: (operation) => execution.sessionForOperation(operation),
        afterTransition: (operation, decision) => execution.afterTransition(operation, decision),
        recordControlFlow: (operation) => execution.recordControlFlow(operation), close: (input) => execution.close(input)
      };
    } };
  }
};
