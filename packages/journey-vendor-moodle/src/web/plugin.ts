import { webClientContract } from "@openuji/journey-platform-web";
import { defineClientPlugin, knownOptions, optionsObject, requiredString } from "@openuji/journey-plugin";
import { parseClientBindings, validateConfiguredOperations } from "@openuji/journey-plugin/client";
import { moodleWebClient } from "./client.js";

export const journeyMeshPlugin = defineClientPlugin({
  kind: "client", clientContract: webClientContract,
  parse(options, context) {
    knownOptions(options, ["touchpoints", "users", "entries", "transitionValues"]);
    const entries = Object.fromEntries(Object.entries(optionsObject(options.entries, "entries")).map(([id, value]) => [id, requiredString(value, `entries.${id}`)]));
    validateConfiguredOperations(options, context.operations);
    const settings = { ...parseClientBindings(options), entries };
    moodleWebClient(settings);
    return settings;
  },
  create(settings) { return moodleWebClient(settings); }
});
