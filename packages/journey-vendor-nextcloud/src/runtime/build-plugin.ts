import { booleanOption, defineServicePlugin, knownOptions, requiredString, sourceCheckoutContract, stringArray } from "@openuji/journey-plugin";
import { buildService, validateBuild } from "./build.js";
import { appBuildContract, serverBuildContract } from "./contracts.js";

export function buildPlugin(server: boolean) {
  return defineServicePlugin({
    kind: "service", inputs: { source: sourceCheckoutContract }, outputs: server ? { image: serverBuildContract } : { app: appBuildContract },
    parse(options, context) {
      knownOptions(options, ["directory", "image", "nodeImage", "composerImage", ...(server ? ["runtimeImage"] : ["composerScripts", "composerIgnorePlatformReqs"])]);
      const settings = { directory: context.resolvePath(requiredString(options.directory, "directory")),
        image: requiredString(options.image, "image"), nodeImage: requiredString(options.nodeImage, "nodeImage"),
        composerImage: requiredString(options.composerImage, "composerImage"),
        ...(server ? { runtimeImage: requiredString(options.runtimeImage, "runtimeImage") } : {}),
        ...(!server && options.composerScripts !== undefined ? { composerScripts: booleanOption(options.composerScripts) } : {}),
        ...(!server && options.composerIgnorePlatformReqs !== undefined
          ? { composerIgnorePlatformReqs: stringArray(options.composerIgnorePlatformReqs, "composerIgnorePlatformReqs") } : {}) };
      validateBuild(settings, server); return settings;
    },
    create(settings, _context, { inputs }) { return buildService(settings, server, undefined, inputs); }
  });
}
