import type {
  JourneyPlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";

import { contract } from "@openuji/journey-plugin";

/** Executors and clients that both declare this contract can be combined. */
export const iosClientContract = contract<IosJourneyClient>("@openuji/journey-platform-ios/client/v1");

/** A built, installable iOS simulator `.app` bundle. `path` is runtime-only and never belongs in a run record. */
export type IosAppBundle = Readonly<{
  path: string;
  sha256: string;
  bundleId: string;
  bundleVersion: string;
  bundleShortVersionString: string;
}>;
export const iosAppContract = contract<IosAppBundle>("@openuji/ios-app/v1");

/** Booted simulator devices by the names a mesh gives them. */
export type IosDevice = Readonly<{
  udid: string;
  simulator: string;
  deviceType: string;
  runtime: string;
  platformVersion: string;
}>;
export type IosDevices = Readonly<Record<string, IosDevice>>;
export const iosDevicesContract = contract<IosDevices>("@openuji/ios-devices/v1");

export type IosApplicationEntryTarget = Readonly<{
  kind: "application";
}>;

export type IosDeepLinkEntryTarget = Readonly<{
  kind: "deep-link";
  url: string;
}>;

export type IosEntryTarget = IosApplicationEntryTarget | IosDeepLinkEntryTarget;

/**
 * An iOS client is a deterministic application binding. Simulator allocation,
 * installation state, application lifecycle, and platform UI belong to Appium.
 */
export type IosJourneyClient = Readonly<{
  name: string;
  version?: string;
  resolveEntry(operation: JourneyPlanOperation): IosEntryTarget;
  resolveTransitionValue(operation: TransitionPlanOperation): string | undefined;
}>;

export function iosApplicationEntryTarget(): IosApplicationEntryTarget {
  return Object.freeze({ kind: "application" });
}

export function iosDeepLinkEntryTarget(url: string): IosDeepLinkEntryTarget {
  return Object.freeze({ kind: "deep-link", url });
}
