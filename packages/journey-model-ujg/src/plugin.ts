import { defineModelPlugin, noOptions } from "@openuji/journey-plugin";
import { compileUjgJourneyPlan, loadUjgDocumentGraph } from "./index.js";
import { toJourneyMapDocument } from "./journey-map.js";

export const journeyMeshPlugin = defineModelPlugin({
  kind: "model",
  parse: noOptions,
  create() {
    // One preparation snapshot: compile and view must not independently refetch imports.
    const graphs = new Map<string, ReturnType<typeof loadUjgDocumentGraph>>();
    const graphFor = (source: string) => {
      let graph = graphs.get(source);
      if (!graph) { graph = loadUjgDocumentGraph(source); graphs.set(source, graph); }
      return graph;
    };
    return {
      compile: async (source, journeyId) => compileUjgJourneyPlan(await graphFor(source), { journeyId }),
      resolveOperation(plan, selector) {
        const matches = plan.operations.filter((operation) => (operation.kind === "state" ? operation.state.id : operation.transition.id) === selector);
        if (matches.length !== 1) throw new Error(`Unknown or ambiguous UJG operation selector: ${selector}`);
        return matches[0];
      },
      /** The journey map is projected from the same JSON-LD document that is executed. */
      async view(source) {
        return { format: "journey-map", document: toJourneyMapDocument(await graphFor(source)) };
      }
    };
  }
});
