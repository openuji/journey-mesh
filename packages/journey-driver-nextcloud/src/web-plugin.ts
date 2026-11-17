import { webDriverContract } from "@openuji/journey-driver-web";
import { defineDriverPlugin, knownOptions, optionsObject, requiredString } from "@openuji/journey-plugin";
import { pluginBindings, validateConfiguredOperations } from "./plugin-options.js";
import { nextcloudWebDriver } from "./web.js";

export const journeyMeshPlugin = defineDriverPlugin({
  kind: "driver", driverContract: webDriverContract,
  parse(options, context) {
    knownOptions(options, ["touchpoints", "users", "entries", "transitionValues"]);
    const entries = Object.fromEntries(Object.entries(optionsObject(options.entries, "entries")).map(([id, value]) => [id, requiredString(value, "web entry route")]));
    validateConfiguredOperations(options, context.operations);
    const settings = { ...pluginBindings(options), entries };
    nextcloudWebDriver(settings);
    return settings;
  },
  create(settings) { return nextcloudWebDriver(settings); }
});
