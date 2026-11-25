import {
  iosApplicationEntryTarget,
  iosDeepLinkEntryTarget,
  type IosJourneyClient
} from "@openuji/journey-platform-ios";
import { bindingForOperation, clientBindings, normalizedURL, transitionValueForOperation } from "@openuji/journey-plugin/client";
import { application, type NextcloudResolverOptions } from "../shared/resolver.js";

export type NextcloudIosEntry = "application" | Readonly<{ kind: "deep-link"; route: string }>;
export type NextcloudIosClientOptions = NextcloudResolverOptions<NextcloudIosEntry>;

export function nextcloudIosClient(options: NextcloudIosClientOptions): IosJourneyClient {
  const config = clientBindings(options, {
    application,
    validateEntry: (entry, id) => {
      if (entry === "application") return;
      if (!entry || entry.kind !== "deep-link" || !entry.route || entry.route.startsWith("//")) {
        throw new Error(`Invalid Nextcloud iOS entry ${id}`);
      }
    }
  });
  return Object.freeze({
    name: "@openuji/journey-vendor-nextcloud/ios",
    version: "0.1.0",
    resolveEntry(operation) {
      const binding = bindingForOperation(config, operation);
      if (binding.entry === "application") return iosApplicationEntryTarget();
      return iosDeepLinkEntryTarget(new URL(binding.entry.route, normalizedURL(binding.touchpoint.baseURL)).href);
    },
    resolveTransitionValue(operation) {
      return transitionValueForOperation(config, operation);
    }
  });
}
