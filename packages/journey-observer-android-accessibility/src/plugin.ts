import { appiumAndroidObservationContract } from "@openuji/journey-executor-appium/observation";
import { booleanOption, defineExecutorObserverPlugin, knownOptions, requiredString, stringArray } from "@openuji/journey-plugin";
import { androidAccessibilityObserver } from "./index.js";

export const journeyMeshPlugin = defineExecutorObserverPlugin({
  kind: "executor-observer", observationContract: appiumAndroidObservationContract,
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
