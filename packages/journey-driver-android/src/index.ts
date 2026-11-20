import type {
  JourneyPlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";

import { contract } from "@openuji/journey-plugin";

/** Adapters and drivers that both declare this contract can be combined. */
export const androidDriverContract = contract<AndroidJourneyDriver>("@openuji/journey-driver-android/v1");

/** A built, installable APK. `path` is runtime-only and never belongs in a run record. */
export type AndroidApk = Readonly<{ path: string; sha256: string; package: string; versionCode: number; versionName: string }>;
export const androidApkContract = contract<AndroidApk>("@openuji/android-apk/v1");

/** Booted devices by the names a mesh gives them. */
export type AndroidDevice = Readonly<{ udid: string; avd: string; api: number }>;
export type AndroidDevices = Readonly<Record<string, AndroidDevice>>;
export const androidDevicesContract = contract<AndroidDevices>("@openuji/android-devices/v1");

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
