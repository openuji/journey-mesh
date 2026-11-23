import { playwrightAutomation } from "@openuji/journey-adapter-playwright";
import { defineObserverPlugin, knownOptions, requiredString } from "@openuji/journey-plugin";
import { operabilityObserver } from "./index.js";

export const journeyMeshPlugin = defineObserverPlugin({
  kind: "observer", automation: playwrightAutomation,
  parse(options) {
    knownOptions(options, ["id"]);
    return { id: requiredString(options.id, "id") };
  },
  create(settings) {
    const observer = operabilityObserver(settings);
    return { observer, output: ({ result }) => observer.output(result) };
  }
});
