import { booleanOption, defineProfilePlugin, knownOptions, requiredString, stringArray } from "@openuji/journey-plugin";
import { defaultProfile, keyboardOnlyProfile, inputModalityProfile, type MaterializationSelectionOptions } from "./index.js";

type Selection = Required<MaterializationSelectionOptions>;

type ProfileSettings =
  | { kind: "preset"; preset: "default" | "keyboard-only"; selection: Selection }
  | { kind: "custom"; id: string; modalityPreference: string[]; selection: Selection };

export const journeyMeshPlugin = defineProfilePlugin({
  kind: "profile",
  parse(options): ProfileSettings {
    knownOptions(options, ["preset", "id", "modalityPreference", "materializationPreference", "requireMaterialization"]);
    const selection: Selection = {
      materializationPreference: options.materializationPreference === undefined
        ? []
        : stringArray(options.materializationPreference, "materializationPreference"),
      requireMaterialization: booleanOption(options.requireMaterialization, true)
    };
    if (options.preset === "default" || options.preset === "keyboard-only") return { kind: "preset", preset: options.preset, selection };
    if (options.preset !== undefined) throw new Error("Unknown interaction profile preset");
    const modalityPreference = stringArray(options.modalityPreference, "modalityPreference");
    if (!modalityPreference.length) throw new Error("modalityPreference must be a nonempty array");
    return { kind: "custom", id: requiredString(options.id, "profile id"), modalityPreference, selection };
  },
  create(settings, context) {
    // A discovery run finds the steps a model does not declare yet, so it cannot require them.
    const selection: Selection = context.mode === "discovery" ? { ...settings.selection, requireMaterialization: false } : settings.selection;
    if (settings.kind === "custom") {
      return inputModalityProfile({ id: settings.id, modalityPreference: settings.modalityPreference, ...selection });
    }
    return settings.preset === "default" ? defaultProfile(selection) : keyboardOnlyProfile(selection);
  }
});
