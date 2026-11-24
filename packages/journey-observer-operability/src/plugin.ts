import { playwrightObservationContract } from "@openuji/journey-executor-playwright/observation";
import { defineExecutorObserverPlugin, knownOptions, requiredString } from "@openuji/journey-plugin";
import { operabilityObserver } from "./index.js";

export const journeyMeshPlugin = defineExecutorObserverPlugin({
  kind: "executor-observer", observationContract: playwrightObservationContract,
  parse(options) {
    knownOptions(options, ["id"]);
    return { id: requiredString(options.id, "id") };
  },
  create(settings) {
    const observer = operabilityObserver(settings);
    return { observer, output: ({ result }) => observer.output(result) };
  }
});
