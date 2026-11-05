import type {
  JourneyPlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";

export const androidDriverContract = "@openuji/journey-driver-android/v1" as const;

export type AndroidApplicationEntryTarget = Readonly<{
  kind: "application";
}>;

export type AndroidDeepLinkEntryTarget = Readonly<{
  kind: "deep-link";
  url: string;
}>;

export type AndroidEntryTarget = AndroidApplicationEntryTarget | AndroidDeepLinkEntryTarget;

/**
 * An Android driver is a deterministic application binding. Device allocation,
 * installation state, application lifecycle, and platform UI belong to Appium.
 */
export type AndroidJourneyDriver = Readonly<{
  name: string;
  version?: string;
  resolveEntry(operation: JourneyPlanOperation): AndroidEntryTarget;
  resolveTransitionValue(operation: TransitionPlanOperation): string | undefined;
}>;

export function androidApplicationEntryTarget(): AndroidApplicationEntryTarget {
  return Object.freeze({ kind: "application" });
}

export function androidDeepLinkEntryTarget(url: string): AndroidDeepLinkEntryTarget {
  return Object.freeze({ kind: "deep-link", url });
}
