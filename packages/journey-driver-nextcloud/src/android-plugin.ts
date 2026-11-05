import { androidDriverContract, type AndroidJourneyDriver } from "@openuji/journey-driver-android";
import { knownOptions, optionsObject, requiredString, type JourneyMeshPlugin } from "@openuji/journey-runtime/plugin";
import { nextcloudAndroidDriver, type NextcloudAndroidEntry } from "./android.js";
import { pluginBindings, validateConfiguredOperations } from "./plugin-options.js";

function entries(options: Record<string, unknown>): Record<string, NextcloudAndroidEntry> {
  return Object.fromEntries(Object.entries(optionsObject(options.entries, "entries")).map(([id, raw]) => {
    if (raw === "application") return [id, "application"];
    const item = optionsObject(raw, `entry ${id}`);
    if (item.kind !== "deep-link") throw new Error(`Android entry ${id} must be application or deep-link`);
    return [id, { kind: "deep-link", route: requiredString(item.route, `entry ${id}.route`) }];
  }));
}

export const journeyMeshPlugin: JourneyMeshPlugin<AndroidJourneyDriver> = {
  apiVersion: 1, kind: "driver", driverContract: androidDriverContract,
  validate(options, context) {
    knownOptions(options, ["touchpoints", "users", "entries", "transitionValues"]);
    validateConfiguredOperations(options, context.operations);
    nextcloudAndroidDriver({ ...pluginBindings(options), entries: entries(options) });
  },
  create(options) {
    return nextcloudAndroidDriver({ ...pluginBindings(options), entries: entries(options) });
  }
};
