import { defineModelPlugin, noOptions } from "@openuji/journey-plugin";
import { compileUjgJourneyPlan } from "./index.js";

export const journeyMeshPlugin = defineModelPlugin({
  kind: "model",
  parse: noOptions,
  create() {
    return {
      compile: (source, journeyId) => compileUjgJourneyPlan(source, { journeyId }),
      resolveOperation(plan, selector) {
        const matches = plan.operations.filter((operation) => (operation.kind === "state" ? operation.state.id : operation.transition.id) === selector);
        if (matches.length !== 1) throw new Error(`Unknown or ambiguous UJG operation selector: ${selector}`);
        return matches[0];
      }
    };
  }
});
