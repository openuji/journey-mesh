import { defineServicePlugin, knownOptions, requiredString, sourceCheckoutContract, stringArray } from "@openuji/journey-plugin";
import { moodleImageContract } from "../contracts.js";
import { moodleBuildService, validateMoodleBuild } from "./build.js";

/** Builds a Moodle image from a `source` checkout (for example `journey-service-git/plugin`). */
export const journeyMeshPlugin = defineServicePlugin({
  kind: "service", inputs: { source: sourceCheckoutContract }, outputs: { image: moodleImageContract },
  parse(options, context) {
    knownOptions(options, ["directory", "image", "runtimeImage", "composerImage", "verifyFiles"]);
    const settings = {
      directory: context.resolvePath(requiredString(options.directory, "directory")),
      image: requiredString(options.image, "image"),
      runtimeImage: requiredString(options.runtimeImage, "runtimeImage"),
      composerImage: requiredString(options.composerImage, "composerImage"),
      verifyFiles: options.verifyFiles === undefined ? [] : stringArray(options.verifyFiles, "verifyFiles")
    };
    validateMoodleBuild(settings);
    return settings;
  },
  create(settings, _context, { inputs }) { return moodleBuildService(settings, undefined, inputs); }
});
