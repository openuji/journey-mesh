import {
  defineServicePlugin, knownOptions, optionalString, requiredString, sourceCheckoutContract, sourceIdentityContract, stringArray
} from "@openuji/journey-plugin";
import { androidApkContract } from "@openuji/journey-platform-android";
import { apkBuildService, validateApkBuild, type ApkBuildOptions } from "./service.js";

export * from "./service.js";

/** `source` → `apk` and `identity`; an optional `sibling` checkout sits next to the source for composite builds. */
export const journeyMeshPlugin = defineServicePlugin({
  kind: "service",
  inputs: { source: sourceCheckoutContract },
  optionalInputs: { sibling: sourceCheckoutContract },
  outputs: { apk: androidApkContract, identity: sourceIdentityContract },
  parse(options, context): ApkBuildOptions {
    knownOptions(options, ["directory", "task", "output", "javaVersion", "toolchains", "sourceDirectory", "siblingDirectory", "arguments"]);
    const major = (value: unknown) => typeof value === "string" ? Number(value) : value as number;
    const javaVersion = major(options.javaVersion);
    if (options.toolchains !== undefined && !Array.isArray(options.toolchains)) throw new Error("toolchains must be an array of JDK major versions");
    const settings: ApkBuildOptions = {
      directory: context.resolvePath(requiredString(options.directory, "directory")),
      task: requiredString(options.task, "task"),
      output: requiredString(options.output, "output"),
      javaVersion,
      toolchains: ((options.toolchains as unknown[] | undefined) ?? []).map(major),
      sourceDirectory: optionalString(options.sourceDirectory, "sourceDirectory") ?? "source",
      ...(options.siblingDirectory !== undefined ? { siblingDirectory: requiredString(options.siblingDirectory, "siblingDirectory") } : {}),
      arguments: options.arguments === undefined ? [] : stringArray(options.arguments, "arguments")
    };
    validateApkBuild(settings);
    return settings;
  },
  create(settings, _context, { inputs }) { return apkBuildService(settings, undefined, inputs); }
});
