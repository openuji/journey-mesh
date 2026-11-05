import type { JourneyEnvironment } from "@openuji/journey-runner";
import {
  booleanOption,
  knownOptions,
  optionsObject,
  positiveNumber,
  requiredString,
  type JourneyMeshPlugin
} from "@openuji/journey-runtime/plugin";

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
    timeoutMs: positiveNumber(options.timeoutMs, 30_000)
  };
};

export const journeyMeshPlugin: JourneyMeshPlugin<JourneyEnvironment> = {
  apiVersion: 1,
  kind: "environment",
  validate(options, context) {
    knownOptions(options, [
      "sharerTouchpoint",
      "recipientTouchpoint",
      "sharerUser",
      "recipientUser",
      "fixturePath",
      "fixtureFileName",
      "effectIds",
      "preserveFixtures",
      "timeoutMs"
    ]);
    createNextcloudFederatedSharingEnvironment(environmentOptions(options, (path) => context.resolvePath(path)));
  },
  create(options, context) {
    return createNextcloudFederatedSharingEnvironment(environmentOptions(options, (path) => context.resolvePath(path)));
  }
};
