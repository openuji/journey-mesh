import { booleanOption, knownOptions, optionsObject, requiredString, type JourneyMeshPlugin, type JourneyObserverComponent } from "@openuji/journey-runtime/plugin";
import { axeObserver } from "./index.js";
import type { AxeObserverOptions } from "./types.js";
export const journeyMeshPlugin: JourneyMeshPlugin<JourneyObserverComponent> = {
  apiVersion: 1, kind: "observer", runtime: "playwright",
  validate(options) {
    knownOptions(options, ["reportId", "strict", "tags", "sourceScreenshots", "evidenceTimeoutMs", "accessibilitySummary"]);
    requiredString(options.reportId, "reportId"); booleanOption(options.strict);
    if (options.tags !== undefined && (!Array.isArray(options.tags) || options.tags.some((tag) => typeof tag !== "string"))) throw new Error("tags must be a string array");
    if (options.sourceScreenshots !== undefined) optionsObject(options.sourceScreenshots, "sourceScreenshots");
  },
  create(options, context) {
    const observer = axeObserver({ ...options, strict: booleanOption(options.strict), artifacts: context.artifacts } as AxeObserverOptions);
    return { observer, reporter: observer };
  }
};
