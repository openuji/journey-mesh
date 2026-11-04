import { knownOptions, optionsObject, requiredString, type JourneyMeshPlugin } from "@openuji/journey-runtime/plugin";
import { nextcloudDriver, openNextcloudRoute, type NextcloudDriverOptions } from "./index.js";
import type { PlaywrightJourneyDriver } from "@openuji/journey-adapter-playwright";
export const journeyMeshPlugin: JourneyMeshPlugin<PlaywrightJourneyDriver> = {
  apiVersion: 1, kind: "driver", runtime: "playwright",
  validate(options, context) {
    knownOptions(options, ["touchpoints", "users", "entries", "transitionValues"]);
    for (const [id, raw] of Object.entries(optionsObject(options.touchpoints, "touchpoints"))) {
      const touchpoint = optionsObject(raw, `touchpoint ${id}`);
      try { new URL(requiredString(touchpoint.baseURL, "baseURL")); } catch { throw new Error(`Invalid baseURL for touchpoint ${id}`); }
    }
    for (const [id, raw] of Object.entries(optionsObject(options.users, "users"))) {
      const user = optionsObject(raw, `user ${id}`); requiredString(user.username, "username"); requiredString(user.password, "password");
    }
    for (const value of Object.values(optionsObject(options.entries, "entries"))) {
      const route = requiredString(value, "entry route");
      if (!route.startsWith("/") || route.startsWith("//")) throw new Error("Entry route must be an application-relative path");
    }
    for (const operation of context.operations) {
      if (!Object.hasOwn(optionsObject(options.users), operation.actorId)) throw new Error(`Missing user for actor ${operation.actorId}`);
      if (!Object.hasOwn(optionsObject(options.touchpoints), operation.touchpointId)) throw new Error(`Missing service for touchpoint ${operation.touchpointId}`);
      if (operation.entryBinding && !Object.hasOwn(optionsObject(options.entries), operation.entryBinding.value)) throw new Error(`Missing entry route for ${operation.entryBinding.value}`);
    }
    if (options.transitionValues !== undefined) for (const value of Object.values(optionsObject(options.transitionValues, "transitionValues"))) requiredString(value, "transition value");
  },
  create(options) {
    return nextcloudDriver({ ...options, entries: Object.fromEntries(Object.entries(options.entries as Record<string, string>).map(([key, route]) => [key, openNextcloudRoute(route)])) } as NextcloudDriverOptions);
  }
};
