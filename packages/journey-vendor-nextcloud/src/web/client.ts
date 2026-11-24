import { webEntryTarget, type WebJourneyClient } from "@openuji/journey-platform-web";
import {
  bindingForOperation, nextcloudResolverConfig, normalizedURL, transitionValueForOperation,
  type NextcloudResolverOptions
} from "../shared/resolver.js";

export type NextcloudWebClientOptions = NextcloudResolverOptions<string>;

export function nextcloudWebClient(options: NextcloudWebClientOptions): WebJourneyClient {
  const config = nextcloudResolverConfig(options, (route, id) => {
    if (!route || (!route.startsWith("/") && !URL.canParse(route))) {
      throw new Error(`Nextcloud web entry ${id} must be an absolute URL or application-relative path`);
    }
    if (route.startsWith("//")) throw new Error(`Nextcloud web entry ${id} must not be protocol-relative`);
  });
  return Object.freeze({
    name: "@openuji/journey-vendor-nextcloud/web",
    version: "0.1.0",
    resolveEntry(operation) {
      const binding = bindingForOperation(config, operation);
      return webEntryTarget(new URL(binding.entry, normalizedURL(binding.touchpoint.baseURL)).href);
    },
    resolveTransitionValue(operation) {
      return transitionValueForOperation(config, operation);
    }
  });
}
