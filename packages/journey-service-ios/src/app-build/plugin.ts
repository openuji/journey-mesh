import {
  defineServicePlugin, knownOptions, optionalString, optionsObject, requiredString, sourceCheckoutContract, sourceIdentityContract, stringArray
} from "@openuji/journey-plugin";
import { iosAppContract } from "@openuji/journey-platform-ios";
import { iosAppBuildService, validateIosAppBuild, type IosAppBuildOptions } from "./service.js";

export * from "./service.js";

/** `source` → `app` and `identity`; an optional `sibling` checkout sits next to the source for local package references. */
export const journeyMeshPlugin = defineServicePlugin({
  kind: "service",
  inputs: { source: sourceCheckoutContract },
  optionalInputs: { sibling: sourceCheckoutContract },
  outputs: { app: iosAppContract, identity: sourceIdentityContract },
  parse(options, context): IosAppBuildOptions {
    knownOptions(options, [
      "directory", "scheme", "project", "workspace", "configuration", "destination", "output",
      "xcodeVersion", "sourceDirectory", "siblingDirectory", "files", "arguments"
    ]);
    const rawFiles = options.files === undefined ? undefined : optionsObject(options.files, "files");
    const files = rawFiles
      ? Object.fromEntries(Object.entries(rawFiles).map(([targetPath, sourcePath]) => [
          targetPath,
          context.resolvePath(requiredString(sourcePath, `files.${targetPath}`))
        ]))
      : undefined;
    const settings: IosAppBuildOptions = {
      directory: context.resolvePath(requiredString(options.directory, "directory")),
      scheme: requiredString(options.scheme, "scheme"),
      ...(options.project !== undefined ? { project: requiredString(options.project, "project") } : {}),
      ...(options.workspace !== undefined ? { workspace: requiredString(options.workspace, "workspace") } : {}),
      configuration: optionalString(options.configuration, "configuration") ?? "Debug",
      ...(options.destination !== undefined ? { destination: requiredString(options.destination, "destination") } : {}),
      output: requiredString(options.output, "output"),
      ...(options.xcodeVersion !== undefined ? { xcodeVersion: requiredString(options.xcodeVersion, "xcodeVersion") } : {}),
      sourceDirectory: optionalString(options.sourceDirectory, "sourceDirectory") ?? "source",
      ...(options.siblingDirectory !== undefined ? { siblingDirectory: requiredString(options.siblingDirectory, "siblingDirectory") } : {}),
      ...(files ? { files } : {}),
      arguments: options.arguments === undefined ? [] : stringArray(options.arguments, "arguments")
    };
    validateIosAppBuild(settings);
    return settings;
  },
  create(settings, _context, { inputs }) { return iosAppBuildService(settings, undefined, inputs); }
});
