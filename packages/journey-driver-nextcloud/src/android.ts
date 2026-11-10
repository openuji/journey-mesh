import {
  androidApplicationEntryTarget, androidDeepLinkEntryTarget, type AndroidJourneyDriver
} from "@openuji/journey-driver-android";
import {
  bindingForOperation, nextcloudResolverConfig, normalizedURL, transitionValueForOperation,
  type NextcloudResolverOptions
} from "./resolver.js";

export type NextcloudAndroidEntry = "application" | Readonly<{ kind: "deep-link"; route: string }>;
export type NextcloudAndroidDriverOptions = NextcloudResolverOptions<NextcloudAndroidEntry>;

export function nextcloudAndroidDriver(options: NextcloudAndroidDriverOptions): AndroidJourneyDriver {
  const config = nextcloudResolverConfig(options, (entry, id) => {
    if (entry === "application") return;
    if (!entry || entry.kind !== "deep-link" || !entry.route || entry.route.startsWith("//")) {
      throw new Error(`Invalid Nextcloud Android entry ${id}`);
    }
  });
  return Object.freeze({
    name: "@openuji/journey-driver-nextcloud/android",
    version: "0.1.0",
    resolveEntry(operation) {
      const binding = bindingForOperation(config, operation);
      if (binding.entry === "application") return androidApplicationEntryTarget();
      return androidDeepLinkEntryTarget(new URL(binding.entry.route, normalizedURL(binding.touchpoint.baseURL)).href);
    },
    resolveTransitionValue(operation) {
      return transitionValueForOperation(config, operation);
    }
  });
}
