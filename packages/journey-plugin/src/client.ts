/**
 * Deterministic binding resolution any vendor's client can share: which entry target, touchpoint
 * and user a modeled operation binds to, and which configured value a transition enters. A client
 * supplies its platform-specific entry type and how to validate it; nothing here knows a vendor,
 * platform or executor. Pure and resource-free, like the clients that use it.
 */
import type { JourneyPlanOperation, TransitionPlanOperation } from "@openuji/journey-execution-model";
import { optionsObject, requiredString } from "./options.js";

export type ClientTouchpointBinding = Readonly<{ baseURL: string }>;
export type ClientUserBinding = Readonly<{ username: string; password: string; label?: string }>;
/** Where a transition value comes from when it is not a literal string. */
export type TransitionValueSource = "touchpoint.baseURL" | "user.username" | "user.password";
export type TransitionValue = string | Readonly<{ source: TransitionValueSource }>;
/** Bindings by model ID: touchpoints and users by touchpoint and actor ID, entries by entry binding, values by transition ID. */
export type ClientBindingOptions<TEntry> = Readonly<{
  touchpoints: Readonly<Record<string, ClientTouchpointBinding>>;
  users: Readonly<Record<string, ClientUserBinding>>;
  entries: Readonly<Record<string, TEntry>>;
  transitionValues?: Readonly<Record<string, TransitionValue>>;
}>;
export type DeepReadonly<T> = T extends readonly (infer TItem)[]
  ? readonly DeepReadonly<TItem>[]
  : T extends object ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> } : T;
/** Validated, deeply frozen bindings. `application` names the bound application in every error. */
export type ClientBindings<TEntry> = DeepReadonly<ClientBindingOptions<TEntry>> & Readonly<{ application: string }>;
export type OperationBinding<TEntry> = Readonly<{
  entry: DeepReadonly<TEntry>;
  touchpoint: DeepReadonly<ClientTouchpointBinding>;
  user: DeepReadonly<ClientUserBinding>;
}>;

const transitionValueSources: readonly TransitionValueSource[] = ["touchpoint.baseURL", "user.username", "user.password"];

/** Validate and freeze a client's bindings. `validateEntry` checks each platform-specific entry target. */
export function clientBindings<TEntry>(
  options: ClientBindingOptions<TEntry>,
  { application, validateEntry }: Readonly<{ application: string; validateEntry: (entry: DeepReadonly<TEntry>, id: string) => void }>
): ClientBindings<TEntry> {
  const config = immutableCopy(options) as DeepReadonly<ClientBindingOptions<TEntry>>;
  if (Object.keys(config.touchpoints).length === 0) throw new Error(`${application} client requires at least one touchpoint`);
  if (Object.keys(config.users).length === 0) throw new Error(`${application} client requires at least one user`);
  if (Object.keys(config.entries).length === 0) throw new Error(`${application} client requires at least one entry target`);
  for (const [id, touchpoint] of Object.entries(config.touchpoints)) {
    try { new URL(touchpoint.baseURL); } catch { throw new Error(`Invalid ${application} baseURL for ${id}`); }
  }
  for (const [id, user] of Object.entries(config.users)) {
    if (!user.username) throw new Error(`${application} user ${id} requires username`);
    if (!user.password) throw new Error(`${application} user ${id} requires password`);
  }
  for (const [id, entry] of Object.entries(config.entries) as [string, DeepReadonly<TEntry>][]) validateEntry(entry, id);
  for (const [id, value] of Object.entries(config.transitionValues ?? {})) {
    if (typeof value === "string") continue;
    if (!value || !transitionValueSources.includes(value.source)) {
      throw new Error(`Invalid ${application} transition value source for ${id}`);
    }
  }
  return Object.freeze({ ...config, application });
}

/** The entry target, touchpoint and user an operation binds to. */
export function bindingForOperation<TEntry>(bindings: ClientBindings<TEntry>, operation: JourneyPlanOperation): OperationBinding<TEntry> {
  const { application } = bindings;
  const entryId = operation.entryBinding?.value;
  if (!entryId) throw new Error(`Operation ${operation.id} has no entry binding`);
  const entry = (bindings.entries as Readonly<Record<string, DeepReadonly<TEntry>>>)[entryId];
  if (entry === undefined) throw new Error(`No ${application} entry target for ${entryId}`);
  const touchpoint = bindings.touchpoints[operation.touchpointId];
  if (!touchpoint) throw new Error(`No ${application} touchpoint for ${operation.touchpointId}`);
  const user = bindings.users[operation.actorId];
  if (!user) throw new Error(`No ${application} user for ${operation.actorId}`);
  return Object.freeze({ entry, touchpoint, user });
}

/** The configured value a transition enters, if any: a literal, or a value of its touchpoint or user. */
export function transitionValueForOperation<TEntry>(bindings: ClientBindings<TEntry>, operation: TransitionPlanOperation): string | undefined {
  const configured = bindings.transitionValues?.[operation.transition.id];
  if (configured === undefined || typeof configured === "string") return configured;
  const binding = bindingForOperation(bindings, operation);
  switch (configured.source) {
    case "touchpoint.baseURL": return normalizedURL(binding.touchpoint.baseURL).href;
    case "user.username": return binding.user.username;
    case "user.password": return binding.user.password;
  }
}

/** A URL without trailing slashes in its path, so relative routes resolve below it. */
export function normalizedURL(value: string): URL {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

/** Parse the `touchpoints`, `users` and `transitionValues` options of a client plugin. Entries are platform-specific. */
export function parseClientBindings(options: Record<string, unknown>): Readonly<{
  touchpoints: Record<string, ClientTouchpointBinding>;
  users: Record<string, ClientUserBinding>;
  transitionValues: Record<string, TransitionValue>;
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
    return [id, { source: requiredString(item.source, `transitionValues.${id}.source`) } as TransitionValue];
  }));
  return { touchpoints, users, transitionValues };
}

/** Before startup: every operation's actor, touchpoint and entry binding has a configured binding. */
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

function immutableCopy<T>(value: T): DeepReadonly<T> {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item !== null && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy as DeepReadonly<T>;
}
