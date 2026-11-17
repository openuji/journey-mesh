import { defineProfilePlugin, knownOptions, requiredString, stringArray } from "@openuji/journey-plugin";
import { defaultProfile, keyboardOnlyProfile, inputModalityProfile } from "./index.js";

type ProfileSettings = { kind: "preset"; preset: "default" | "keyboard-only" } | { kind: "custom"; id: string; modalityPreference: string[] };

export const journeyMeshPlugin = defineProfilePlugin({
  kind: "profile",
  parse(options): ProfileSettings {
    knownOptions(options, ["preset", "id", "modalityPreference"]);
    if (options.preset === "default" || options.preset === "keyboard-only") return { kind: "preset", preset: options.preset };
    if (options.preset !== undefined) throw new Error("Unknown interaction profile preset");
    const modalityPreference = stringArray(options.modalityPreference, "modalityPreference");
    if (!modalityPreference.length) throw new Error("modalityPreference must be a nonempty array");
    return { kind: "custom", id: requiredString(options.id, "profile id"), modalityPreference };
  },
  create(settings) {
    if (settings.kind === "custom") return inputModalityProfile({ id: settings.id, modalityPreference: settings.modalityPreference });
    return settings.preset === "default" ? defaultProfile() : keyboardOnlyProfile();
  }
});
