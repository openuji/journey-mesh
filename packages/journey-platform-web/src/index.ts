import type {
  JourneyPlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";

import { contract } from "@openuji/journey-plugin";

/** Executors and clients that both declare this contract can be combined. */
export const webClientContract = contract<WebJourneyClient>("@openuji/journey-platform-web/client/v1");

export type WebEntryTarget = Readonly<{
  kind: "url";
  url: string;
}>;

/**
 * A web client is a deterministic application binding. It owns no browser,
 * execution, session, lifecycle, cache, callback, or mutable collection.
 */
export type WebJourneyClient = Readonly<{
  name: string;
  version?: string;
  resolveEntry(operation: JourneyPlanOperation): WebEntryTarget;
  resolveTransitionValue(operation: TransitionPlanOperation): string | undefined;
}>;

export function webEntryTarget(url: string): WebEntryTarget {
  return Object.freeze({ kind: "url", url });
}
