import { defineServicePlugin, knownOptions, optionsObject, requiredString, sourceIdentityContract } from "@openuji/journey-plugin";
import { ownershipPath } from "@openuji/journey-plugin/node";
import { composeStackContract } from "@openuji/journey-service-docker/compose";
import { moodleImageContract, type MoodleImage } from "../contracts.js";
import { moodleStackRuntime, stopMoodleStack, validateMoodleStackOptions, type MoodleStackOptions } from "./stack.js";

const record = (value: unknown, label: string, keys: readonly string[]): Record<string, string> => {
  const item = optionsObject(value, label);
  knownOptions(item, keys);
  return Object.fromEntries(keys.map((key) => [key, requiredString(item[key], `${label}.${key}`)]));
};

/**
 * A fresh Moodle site on Docker Compose, installed from the `image` input (`./build/service`). It outputs the
 * running stack for services that act inside it (such as `./user-tours/service`) and the source identity.
 */
export const journeyMeshPlugin = defineServicePlugin({
  kind: "service", inputs: { image: moodleImageContract }, outputs: { stack: composeStackContract, identity: sourceIdentityContract },
  parse(options, context) {
    knownOptions(options, ["project", "composeFiles", "directory", "environment", "service", "baseURL", "site", "admin", "database", "config"]);
    if (!Array.isArray(options.composeFiles)) throw new Error("composeFiles must be an array");
    const settings: MoodleStackOptions = {
      project: requiredString(options.project, "project"),
      composeFiles: options.composeFiles.map((file) => context.resolvePath(requiredString(file, "composeFiles"))),
      directory: context.resolvePath(requiredString(options.directory, "directory")),
      environment: Object.fromEntries(Object.entries(optionsObject(options.environment ?? {}, "environment")).map(([key, value]) => [key, requiredString(value, `environment.${key}`)])),
      service: requiredString(options.service ?? "moodle", "service"),
      baseURL: requiredString(options.baseURL, "baseURL"),
      site: record(options.site, "site", ["fullname", "shortname"]) as MoodleStackOptions["site"],
      admin: record(options.admin, "admin", ["username", "password", "email"]) as MoodleStackOptions["admin"],
      database: record(options.database, "database", ["host", "name", "user", "password"]) as MoodleStackOptions["database"],
      config: Object.fromEntries(Object.entries(optionsObject(options.config ?? {}, "config")).map(([key, value]) => [key, requiredString(String(value), `config.${key}`)]))
    };
    validateMoodleStackOptions(settings);
    return settings;
  },
  create(settings, context, { inputs }) {
    const image = inputs.image as MoodleImage | undefined;
    if (!image?.identity.version) throw new Error("Missing built Moodle image or release");
    return moodleStackRuntime(settings, image, context, undefined, ownershipPath(context.configPath, context.componentId));
  },
  stopConfigured: stopMoodleStack
});
