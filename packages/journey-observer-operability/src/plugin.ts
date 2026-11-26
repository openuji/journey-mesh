import { playwrightObservationContract } from "@openuji/journey-executor-playwright/observation";
import { defineExecutorObserverPlugin, knownOptions, requiredString } from "@openuji/journey-plugin";
import { operabilityObserver } from "./index.js";

export const journeyMeshPlugin = defineExecutorObserverPlugin({
  kind: "executor-observer", observationContract: playwrightObservationContract,
  parse(options) {
    knownOptions(options, ["id"]);
    return { id: requiredString(options.id, "id") };
  },
  create(settings, context) {
    const observer = operabilityObserver({ ...settings, operationIds: context.operations.map((operation) => operation.id) });
    return { observer, output: ({ result }) => observer.output(result) };
  }
});
