import type {
  JourneyPlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";

export const webDriverContract = "@openuji/journey-driver-web/v1" as const;

export type WebEntryTarget = Readonly<{
  kind: "url";
  url: string;
}>;

/**
 * A web driver is a deterministic application binding. It owns no browser,
 * execution, session, lifecycle, cache, callback, or mutable collection.
 */
export type WebJourneyDriver = Readonly<{
  name: string;
  version?: string;
  resolveEntry(operation: JourneyPlanOperation): WebEntryTarget;
  resolveTransitionValue(operation: TransitionPlanOperation): string | undefined;
}>;

export function webEntryTarget(url: string): WebEntryTarget {
  return Object.freeze({ kind: "url", url });
}
