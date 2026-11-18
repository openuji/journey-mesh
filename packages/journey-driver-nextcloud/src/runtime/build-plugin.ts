import { defineServicePlugin, knownOptions, requiredString, sourceCheckoutContract } from "@openuji/journey-plugin";
import { buildService, validateBuild } from "./build.js";
import { appBuildContract, serverBuildContract } from "./contracts.js";

export function buildPlugin(server: boolean) {
  return defineServicePlugin({
    kind: "service", inputs: { source: sourceCheckoutContract }, outputs: server ? { image: serverBuildContract } : { app: appBuildContract },
    parse(options, context) {
      knownOptions(options, ["directory", "image", "nodeImage", "composerImage", ...(server ? ["runtimeImage"] : [])]);
      const settings = { directory: context.resolvePath(requiredString(options.directory, "directory")),
        image: requiredString(options.image, "image"), nodeImage: requiredString(options.nodeImage, "nodeImage"),
        composerImage: requiredString(options.composerImage, "composerImage"),
        ...(server ? { runtimeImage: requiredString(options.runtimeImage, "runtimeImage") } : {}) };
      validateBuild(settings, server); return settings;
    },
    create(settings) { return buildService(settings, server); }
  });
}
