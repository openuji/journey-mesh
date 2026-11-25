import { playwrightObservationContract } from "@openuji/journey-executor-playwright/observation";
import { defineExecutorObserverPlugin, knownOptions, optionalString } from "@openuji/journey-plugin";
import { findingsObserver, type FindingsConfiguration } from "./playwright.js";

/**
 * Options: `id`, the observer output id (default `findings`). Nothing else: what a finding is comes from
 * the model, as an operation that failed against what it declares.
 */
function settings(options: Record<string, unknown>): FindingsConfiguration {
  knownOptions(options, ["id"]);
  return { id: optionalString(options.id, "id") ?? "findings" };
}

export const journeyMeshPlugin = defineExecutorObserverPlugin({
  kind: "executor-observer", observationContract: playwrightObservationContract,
  parse: settings,
  create(configuration, context) {
    const observer = findingsObserver(configuration, context.artifacts);
    return { observer, output: ({ result }) => observer.output(result) };
  }
});
