// A second vendor's Web client. It is built only from the plugin API and the Web platform contract:
// no runner, host or executor change, and no Nextcloud code.
import { defineClientPlugin, knownOptions, requiredString } from "@openuji/journey-plugin";
import { webClientContract, webEntryTarget } from "@openuji/journey-platform-web";

export const journeyMeshPlugin = defineClientPlugin({
  kind: "client", clientContract: webClientContract,
  parse(options) {
    knownOptions(options, ["baseURL"]);
    return { baseURL: new URL(requiredString(options.baseURL, "baseURL")).href };
  },
  create({ baseURL }) {
    return Object.freeze({
      name: "@example/journey-vendor-moodle/web",
      resolveEntry: (operation) => webEntryTarget(new URL(`/course/${operation.entryBinding?.value ?? ""}`, baseURL).href),
      resolveTransitionValue: () => undefined
    });
  }
});
