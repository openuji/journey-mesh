import { iosClientContract } from "@openuji/journey-platform-ios";
import { defineClientPlugin, knownOptions, optionsObject, requiredString } from "@openuji/journey-plugin";
import { parseClientBindings, validateConfiguredOperations } from "@openuji/journey-plugin/client";
import { nextcloudIosClient, type NextcloudIosEntry } from "./client.js";

function entries(options: Record<string, unknown>): Record<string, NextcloudIosEntry> {
  return Object.fromEntries(
    Object.entries(optionsObject(options.entries, "entries")).map(([id, raw]) => {
      if (raw === "application") return [id, "application"];
      const item = optionsObject(raw, `entry ${id}`);
      if (item.kind !== "deep-link") throw new Error(`iOS entry ${id} must be application or deep-link`);
      return [id, { kind: "deep-link", route: requiredString(item.route, `entry ${id}.route`) }];
    })
  );
}

export const journeyMeshPlugin = defineClientPlugin({
  kind: "client",
  clientContract: iosClientContract,
  parse(options, context) {
    knownOptions(options, ["touchpoints", "users", "entries", "transitionValues"]);
    validateConfiguredOperations(options, context.operations);
    const settings = { ...parseClientBindings(options), entries: entries(options) };
    nextcloudIosClient(settings);
    return settings;
  },
  create(settings) {
    return nextcloudIosClient(settings);
  }
});
