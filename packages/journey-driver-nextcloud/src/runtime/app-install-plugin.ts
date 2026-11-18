import { booleanOption, defineServicePlugin, knownOptions, requiredString, sourceIdentityContract, stringArray } from "@openuji/journey-plugin";
import { appBuildContract, managedStackContract } from "./contracts.js";
import { appInstall } from "./app-install.js";
export const journeyMeshPlugin = defineServicePlugin({
  kind: "service", inputs: { app: appBuildContract, stack: managedStackContract }, outputs: { identity: sourceIdentityContract },
  parse(options, context) {
    knownOptions(options, ["directory", "services", "enable"]);
    const services = stringArray(options.services, "services");
    if (!services.length || services.some((name) => !/^[a-z][a-z0-9_-]*$/.test(name))) throw new Error("Installation services must be nonempty service names");
    return { directory: context.resolvePath(requiredString(options.directory, "directory")), services, enable: booleanOption(options.enable, true) };
  },
  create: (settings) => appInstall(settings)
});
