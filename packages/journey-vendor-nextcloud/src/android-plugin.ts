import { androidClientContract } from "@openuji/journey-platform-android";
import { defineClientPlugin, knownOptions, optionsObject, requiredString } from "@openuji/journey-plugin";
import { nextcloudAndroidClient, type NextcloudAndroidEntry } from "./android.js";
import { pluginBindings, validateConfiguredOperations } from "./plugin-options.js";

function entries(options: Record<string, unknown>): Record<string, NextcloudAndroidEntry> {
  return Object.fromEntries(Object.entries(optionsObject(options.entries, "entries")).map(([id, raw]) => {
    if (raw === "application") return [id, "application"];
    const item = optionsObject(raw, `entry ${id}`);
    if (item.kind !== "deep-link") throw new Error(`Android entry ${id} must be application or deep-link`);
    return [id, { kind: "deep-link", route: requiredString(item.route, `entry ${id}.route`) }];
  }));
}

export const journeyMeshPlugin = defineClientPlugin({
  kind: "client", clientContract: androidClientContract,
  parse(options, context) {
    knownOptions(options, ["touchpoints", "users", "entries", "transitionValues"]);
    validateConfiguredOperations(options, context.operations);
    const settings = { ...pluginBindings(options), entries: entries(options) };
    nextcloudAndroidClient(settings);
    return settings;
  },
  create(settings) { return nextcloudAndroidClient(settings); }
});
