import { webEntryTarget, type WebJourneyDriver } from "@openuji/journey-driver-web";
import {
  bindingForOperation, nextcloudResolverConfig, normalizedURL, transitionValueForOperation,
  type NextcloudResolverOptions
} from "./resolver.js";

export type NextcloudWebDriverOptions = NextcloudResolverOptions<string>;

export function nextcloudWebDriver(options: NextcloudWebDriverOptions): WebJourneyDriver {
  const config = nextcloudResolverConfig(options, (route, id) => {
    if (!route || (!route.startsWith("/") && !URL.canParse(route))) {
      throw new Error(`Nextcloud web entry ${id} must be an absolute URL or application-relative path`);
    }
    if (route.startsWith("//")) throw new Error(`Nextcloud web entry ${id} must not be protocol-relative`);
  });
  return Object.freeze({
    name: "@openuji/journey-driver-nextcloud/web",
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
