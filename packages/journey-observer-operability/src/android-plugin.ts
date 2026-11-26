import { appiumAndroidObservationContract } from "@openuji/journey-executor-appium/observation";
import { defineExecutorObserverPlugin, knownOptions, requiredString } from "@openuji/journey-plugin";
import { operabilityObserver } from "./index.js";

export const journeyMeshPlugin = defineExecutorObserverPlugin({
  kind: "executor-observer", observationContract: appiumAndroidObservationContract,
  parse(options) {
    knownOptions(options, ["id"]);
    return { id: requiredString(options.id, "id") };
  },
  create(settings, context) {
    const observer = operabilityObserver({ ...settings, operationIds: context.operations.map((operation) => operation.id) });
    return { observer, output: ({ result }) => observer.output(result) };
  }
});
