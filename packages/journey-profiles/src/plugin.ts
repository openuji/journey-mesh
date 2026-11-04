import { knownOptions, requiredString, type JourneyMeshPlugin } from "@openuji/journey-runtime/plugin";
import type { JourneyProfile } from "@openuji/journey-runner";
import { defaultProfile, keyboardOnlyProfile, inputModalityProfile } from "./index.js";
export const journeyMeshPlugin: JourneyMeshPlugin<JourneyProfile> = {
  apiVersion: 1, kind: "profile",
  validate(options) {
    knownOptions(options, ["preset", "id", "modalityPreference"]);
    if (options.preset !== undefined && options.preset !== "default" && options.preset !== "keyboard-only") throw new Error("Unknown interaction profile preset");
    if (!options.preset) {
      requiredString(options.id, "profile id");
      if (!Array.isArray(options.modalityPreference) || !options.modalityPreference.length) throw new Error("modalityPreference must be a nonempty array");
      options.modalityPreference.forEach((item) => requiredString(item, "modalityPreference item"));
    }
  },
  create(options) {
    if (options.preset === "default") return defaultProfile();
    if (options.preset === "keyboard-only") return keyboardOnlyProfile();
    return inputModalityProfile({ id: options.id as string, modalityPreference: options.modalityPreference as string[] });
  }
};
