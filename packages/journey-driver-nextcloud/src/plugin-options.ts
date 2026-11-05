import { optionsObject, requiredString } from "@openuji/journey-runtime/plugin";
import type {
  NextcloudTouchpointBinding, NextcloudTransitionValue, NextcloudUserBinding
} from "./resolver.js";

export function pluginBindings(options: Record<string, unknown>): Readonly<{
  touchpoints: Record<string, NextcloudTouchpointBinding>;
  users: Record<string, NextcloudUserBinding>;
  transitionValues: Record<string, NextcloudTransitionValue>;
}> {
  const touchpoints = Object.fromEntries(Object.entries(optionsObject(options.touchpoints, "touchpoints")).map(([id, raw]) => {
    const item = optionsObject(raw, `touchpoint ${id}`);
    return [id, { baseURL: requiredString(item.baseURL, `touchpoint ${id}.baseURL`) }];
  }));
  const users = Object.fromEntries(Object.entries(optionsObject(options.users, "users")).map(([id, raw]) => {
    const item = optionsObject(raw, `user ${id}`);
    return [id, {
      username: requiredString(item.username, `user ${id}.username`),
      password: requiredString(item.password, `user ${id}.password`),
      ...(typeof item.label === "string" ? { label: item.label } : {})
    }];
  }));
  const transitionValues = Object.fromEntries(Object.entries(optionsObject(options.transitionValues ?? {}, "transitionValues")).map(([id, raw]) => {
    if (typeof raw === "string") return [id, raw];
    const item = optionsObject(raw, `transitionValues.${id}`);
    return [id, { source: requiredString(item.source, `transitionValues.${id}.source`) } as NextcloudTransitionValue];
  }));
  return { touchpoints, users, transitionValues };
}

export function validateConfiguredOperations(
  options: Record<string, unknown>,
  operations: readonly { actorId: string; touchpointId: string; entryBinding?: { value: string } }[]
): void {
  const users = optionsObject(options.users, "users");
  const touchpoints = optionsObject(options.touchpoints, "touchpoints");
  const entries = optionsObject(options.entries, "entries");
  for (const operation of operations) {
    if (!Object.hasOwn(users, operation.actorId)) throw new Error(`Missing user for actor ${operation.actorId}`);
    if (!Object.hasOwn(touchpoints, operation.touchpointId)) throw new Error(`Missing touchpoint ${operation.touchpointId}`);
    if (operation.entryBinding && !Object.hasOwn(entries, operation.entryBinding.value)) {
      throw new Error(`Missing entry target for ${operation.entryBinding.value}`);
    }
  }
}
