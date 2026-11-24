import { webClientContract } from "@openuji/journey-platform-web";
import { defineClientPlugin, knownOptions, optionsObject, requiredString } from "@openuji/journey-plugin";
import { parseClientBindings, validateConfiguredOperations } from "@openuji/journey-plugin/client";
import { nextcloudWebClient } from "./client.js";

export const journeyMeshPlugin = defineClientPlugin({
  kind: "client", clientContract: webClientContract,
  parse(options, context) {
    knownOptions(options, ["touchpoints", "users", "entries", "transitionValues"]);
    const entries = Object.fromEntries(Object.entries(optionsObject(options.entries, "entries")).map(([id, value]) => [id, requiredString(value, "web entry route")]));
    validateConfiguredOperations(options, context.operations);
    const settings = { ...parseClientBindings(options), entries };
    nextcloudWebClient(settings);
    return settings;
  },
  create(settings) { return nextcloudWebClient(settings); }
});
