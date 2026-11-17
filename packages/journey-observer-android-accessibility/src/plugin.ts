import { appiumAutomation } from "@openuji/journey-adapter-appium";
import { booleanOption, defineObserverPlugin, knownOptions, requiredString, stringArray } from "@openuji/journey-plugin";
import { androidAccessibilityObserver } from "./index.js";

export const journeyMeshPlugin = defineObserverPlugin({
  kind: "observer", automation: appiumAutomation,
  parse(options) {
    knownOptions(options, ["reportId", "strict", "screenshots", "excludedPhaseIds"]);
    return {
      reportId: requiredString(options.reportId, "reportId"), strict: booleanOption(options.strict), screenshots: booleanOption(options.screenshots, true),
      ...(options.excludedPhaseIds !== undefined ? { excludedPhaseIds: stringArray(options.excludedPhaseIds, "excludedPhaseIds") } : {})
    };
  },
  create(settings, context) {
    const observer = androidAccessibilityObserver({ ...settings, writeArtifact: (input) => context.artifacts.write(input) });
    return { observer, output: ({ result }) => observer.output(result) };
  }
});
