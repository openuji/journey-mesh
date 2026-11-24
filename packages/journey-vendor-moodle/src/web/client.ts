import { webEntryTarget, type WebJourneyClient } from "@openuji/journey-platform-web";
import { bindingForOperation, clientBindings, normalizedURL, transitionValueForOperation, type ClientBindingOptions } from "@openuji/journey-plugin/client";

/** Entries are routes relative to the site's wwwroot, such as `/login/index.php` or `/my/`. */
export type MoodleWebClientOptions = ClientBindingOptions<string>;

export function moodleWebClient(options: MoodleWebClientOptions): WebJourneyClient {
  const config = clientBindings(options, { application: "Moodle", validateEntry: (route, id) => {
    if (!route || !route.startsWith("/") || route.startsWith("//")) throw new Error(`Moodle web entry ${id} must be a path relative to the site, starting with one /`);
  } });
  return Object.freeze({
    name: "@openuji/journey-vendor-moodle/web",
    version: "0.1.0",
    resolveEntry(operation) {
      const binding = bindingForOperation(config, operation);
      // A site may live below a path (https://host/moodle); routes resolve inside it.
      const base = normalizedURL(binding.touchpoint.baseURL);
      return webEntryTarget(new URL(`${base.pathname.replace(/\/+$/, "")}${binding.entry}`, base).href);
    },
    resolveTransitionValue(operation) {
      return transitionValueForOperation(config, operation);
    }
  });
}
