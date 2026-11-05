import { webDriverContract, type WebJourneyDriver } from "@openuji/journey-driver-web";
import { knownOptions, optionsObject, requiredString, type JourneyMeshPlugin } from "@openuji/journey-runtime/plugin";
import { pluginBindings, validateConfiguredOperations } from "./plugin-options.js";
import { nextcloudWebDriver } from "./web.js";

export const journeyMeshPlugin: JourneyMeshPlugin<WebJourneyDriver> = {
  apiVersion: 1, kind: "driver", driverContract: webDriverContract,
  validate(options, context) {
    knownOptions(options, ["touchpoints", "users", "entries", "transitionValues"]);
    const configuredEntries = optionsObject(options.entries, "entries");
    for (const value of Object.values(configuredEntries)) requiredString(value, "web entry route");
    validateConfiguredOperations(options, context.operations);
    nextcloudWebDriver({ ...pluginBindings(options), entries: configuredEntries as Record<string, string> });
  },
  create(options) {
    return nextcloudWebDriver({
      ...pluginBindings(options), entries: optionsObject(options.entries, "entries") as Record<string, string>
    });
  }
};
