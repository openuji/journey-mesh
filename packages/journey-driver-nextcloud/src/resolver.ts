import type {
  JourneyPlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";

export type NextcloudTouchpointBinding = Readonly<{ baseURL: string }>;
export type NextcloudUserBinding = Readonly<{ username: string; password: string; label?: string }>;
export type NextcloudTransitionValueSource = "touchpoint.baseURL" | "user.username" | "user.password";
export type NextcloudTransitionValue = string | Readonly<{ source: NextcloudTransitionValueSource }>;
export type NextcloudResolverOptions<TEntry> = Readonly<{
  touchpoints: Readonly<Record<string, NextcloudTouchpointBinding>>;
  users: Readonly<Record<string, NextcloudUserBinding>>;
  entries: Readonly<Record<string, TEntry>>;
  transitionValues?: Readonly<Record<string, NextcloudTransitionValue>>;
}>;
export type NextcloudResolverConfig<TEntry> = DeepReadonly<NextcloudResolverOptions<TEntry>>;

type DeepReadonly<T> = T extends readonly (infer TItem)[]
  ? readonly DeepReadonly<TItem>[]
  : T extends object ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> } : T;

export function nextcloudResolverConfig<TEntry>(
  options: NextcloudResolverOptions<TEntry>,
  validateEntry: (entry: DeepReadonly<TEntry>, id: string) => void
): NextcloudResolverConfig<TEntry> {
  const config = immutableCopy(options) as NextcloudResolverConfig<TEntry>;
  if (Object.keys(config.touchpoints).length === 0) throw new Error("Nextcloud driver requires at least one touchpoint");
  if (Object.keys(config.users).length === 0) throw new Error("Nextcloud driver requires at least one user");
  if (Object.keys(config.entries).length === 0) throw new Error("Nextcloud driver requires at least one entry target");
  for (const [id, touchpoint] of Object.entries(config.touchpoints)) {
    try { new URL(touchpoint.baseURL); } catch { throw new Error(`Invalid Nextcloud baseURL for ${id}`); }
  }
  for (const [id, user] of Object.entries(config.users)) {
    if (!user.username) throw new Error(`Nextcloud user ${id} requires username`);
    if (!user.password) throw new Error(`Nextcloud user ${id} requires password`);
  }
  for (const [id, entry] of Object.entries(config.entries)) validateEntry(entry, id);
  for (const [id, value] of Object.entries(config.transitionValues ?? {})) {
    if (typeof value === "string") continue;
    if (!value || !["touchpoint.baseURL", "user.username", "user.password"].includes(value.source)) {
      throw new Error(`Invalid Nextcloud transition value source for ${id}`);
    }
  }
  return config;
}

export function bindingForOperation<TEntry>(
  config: NextcloudResolverConfig<TEntry>,
  operation: JourneyPlanOperation
): Readonly<{
  entry: DeepReadonly<TEntry>;
  touchpoint: DeepReadonly<NextcloudTouchpointBinding>;
  user: DeepReadonly<NextcloudUserBinding>;
}> {
  const entryId = operation.entryBinding?.value;
  if (!entryId) throw new Error(`Operation ${operation.id} has no entry binding`);
  const entry = config.entries[entryId];
  if (entry === undefined) throw new Error(`No Nextcloud entry target for ${entryId}`);
  const touchpoint = config.touchpoints[operation.touchpointId];
  if (!touchpoint) throw new Error(`No Nextcloud touchpoint for ${operation.touchpointId}`);
  const user = config.users[operation.actorId];
  if (!user) throw new Error(`No Nextcloud user for ${operation.actorId}`);
  return Object.freeze({ entry, touchpoint, user });
}

export function transitionValueForOperation<TEntry>(
  config: NextcloudResolverConfig<TEntry>,
  operation: TransitionPlanOperation
): string | undefined {
  const configured = config.transitionValues?.[operation.transition.id];
  if (configured === undefined || typeof configured === "string") return configured;
  const binding = bindingForOperation(config, operation);
  switch (configured.source) {
    case "touchpoint.baseURL": return normalizedURL(binding.touchpoint.baseURL).href;
    case "user.username": return binding.user.username;
    case "user.password": return binding.user.password;
  }
}

export function normalizedURL(value: string): URL {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
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
