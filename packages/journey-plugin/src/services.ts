import { contract } from "./plugins.js";

/** Public identity only. Runtime paths and credentials never belong here. */
export type SourceIdentity = Readonly<{
  repository: string;
  sourceSha: string;
  pullRequest?: number;
  version?: string;
}>;
export type SourceCheckout = Readonly<{ directory: string; identity: SourceIdentity }>;
export const sourceIdentityContract = contract<SourceIdentity>("@openuji/source-identity/v1");
export const sourceCheckoutContract = contract<SourceCheckout>("@openuji/source-checkout/v1");

export function sourceIdentity(value: unknown): SourceIdentity {
  const item = value as Partial<SourceIdentity> | null;
  if (!item || typeof item.repository !== "string" || !/^https:\/\//.test(item.repository)
    || typeof item.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(item.sourceSha)
    || (item.pullRequest !== undefined && (!Number.isSafeInteger(item.pullRequest) || item.pullRequest < 1))
    || (item.version !== undefined && typeof item.version !== "string")) throw new Error("Invalid source identity");
  return Object.freeze({ repository: item.repository, sourceSha: item.sourceSha,
    ...(item.pullRequest === undefined ? {} : { pullRequest: item.pullRequest }),
    ...(item.version === undefined ? {} : { version: item.version }) });
}
