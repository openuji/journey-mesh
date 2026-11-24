import {
  booleanOption,
  defineEnvironmentPlugin,
  knownOptions,
  optionsObject,
  positiveNumber,
  requiredString
} from "@openuji/journey-plugin";

import {
  createNextcloudFederatedSharingEnvironment,
  type NextcloudFederatedSharingEnvironmentOptions
} from "./federated-sharing.js";
import type { NextcloudTouchpointConfig, NextcloudUserConfig } from "./service.js";

const touchpointOption = (options: Record<string, unknown>, name: string): NextcloudTouchpointConfig => {
  const touchpoint = optionsObject(options[name], name);
  const baseURL = requiredString(touchpoint.baseURL, `${name}.baseURL`);
  try { new URL(baseURL); } catch { throw new Error(`Invalid ${name}.baseURL`); }
  return { baseURL };
};

const userOption = (options: Record<string, unknown>, name: string): NextcloudUserConfig => {
  const user = optionsObject(options[name], name);
  return {
    username: requiredString(user.username, `${name}.username`),
    password: requiredString(user.password, `${name}.password`),
    ...(typeof user.label === "string" ? { label: user.label } : {})
  };
};

const environmentOptions = (
  options: Record<string, unknown>,
  resolvePath: (path: string) => string
): NextcloudFederatedSharingEnvironmentOptions => {
  const effectIds = optionsObject(options.effectIds, "effectIds");
  return {
    sharerTouchpoint: touchpointOption(options, "sharerTouchpoint"),
    recipientTouchpoint: touchpointOption(options, "recipientTouchpoint"),
    sharerUser: userOption(options, "sharerUser"),
    recipientUser: userOption(options, "recipientUser"),
    fixturePath: resolvePath(requiredString(options.fixturePath, "fixturePath")),
    fixtureFileName: requiredString(options.fixtureFileName, "fixtureFileName"),
    effectIds: {
      shareCreated: requiredString(effectIds.shareCreated, "effectIds.shareCreated"),
      shareAccepted: requiredString(effectIds.shareAccepted, "effectIds.shareAccepted")
    },
    preserveFixtures: booleanOption(options.preserveFixtures),
    ...(options.recipientViewConfig !== undefined ? { recipientViewConfig: recipientViewConfigOption(options.recipientViewConfig) } : {}),
    timeoutMs: positiveNumber(options.timeoutMs, 30_000)
  };
};

function recipientViewConfigOption(value: unknown): NonNullable<NextcloudFederatedSharingEnvironmentOptions["recipientViewConfig"]> {
  const views = optionsObject(value, "recipientViewConfig");
  return Object.fromEntries(Object.entries(views).map(([view, settings]) => [view,
    Object.fromEntries(Object.entries(optionsObject(settings, `recipientViewConfig.${view}`)).map(([key, entry]) => {
      if (!["string", "number", "boolean"].includes(typeof entry) || typeof entry === "number" && !Number.isFinite(entry)) throw new Error(`Invalid view configuration ${view}.${key}`);
      return [key, entry as string | number | boolean];
    }))
  ]));
}

export const journeyMeshPlugin = defineEnvironmentPlugin({
  kind: "environment",
  parse(options, context) {
    knownOptions(options, [
      "sharerTouchpoint",
      "recipientTouchpoint",
      "sharerUser",
      "recipientUser",
      "fixturePath",
      "fixtureFileName",
      "effectIds",
      "preserveFixtures",
      "recipientViewConfig",
      "timeoutMs"
    ]);
    const settings = environmentOptions(options, (path) => context.resolvePath(path));
    createNextcloudFederatedSharingEnvironment(settings);
    return settings;
  },
  create(settings) { return createNextcloudFederatedSharingEnvironment(settings); }
});
