import { playwrightObservationContract } from "@openuji/journey-executor-playwright/observation";
import { booleanOption, defineExecutorObserverPlugin, knownOptions, optionsObject, positiveNumber, requiredString, stringArray } from "@openuji/journey-plugin";
import { axeObserver } from "./index.js";

export const journeyMeshPlugin = defineExecutorObserverPlugin({
  kind: "executor-observer", observationContract: playwrightObservationContract,
  parse(options) {
    knownOptions(options, ["reportId", "strict", "tags", "sourceScreenshots", "evidenceTimeoutMs", "excludedPhaseIds"]);
    const screenshots = options.sourceScreenshots === undefined ? undefined : optionsObject(options.sourceScreenshots, "sourceScreenshots");
    if (screenshots) knownOptions(screenshots, ["states", "fullPage", "timeoutMs"]);
    return {
      reportId: requiredString(options.reportId, "reportId"),
      strict: booleanOption(options.strict),
      ...(options.tags !== undefined ? { tags: stringArray(options.tags, "tags") } : {}),
      ...(options.excludedPhaseIds !== undefined ? { excludedPhaseIds: stringArray(options.excludedPhaseIds, "excludedPhaseIds") } : {}),
      ...(options.evidenceTimeoutMs !== undefined ? { evidenceTimeoutMs: positiveNumber(options.evidenceTimeoutMs, 0) } : {}),
      ...(screenshots ? { sourceScreenshots: {
        states: booleanOption(screenshots.states), fullPage: booleanOption(screenshots.fullPage, true),
        ...(screenshots.timeoutMs !== undefined ? { timeoutMs: positiveNumber(screenshots.timeoutMs, 0) } : {})
      } } : {})
    };
  },
  create(settings, context) {
    const observer = axeObserver({ ...settings, artifacts: context.artifacts });
    return { observer, output: ({ result }) => observer.output(result) };
  }
});
