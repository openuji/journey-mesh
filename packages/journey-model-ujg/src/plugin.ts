import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineModelPlugin, noOptions } from "@openuji/journey-plugin";
import { compileUjgJourneyPlan, declareDiscoveredMaterializations, loadUjgDocumentGraph } from "./index.js";
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
      },
      /** Rewrites a local document only; the caller writes the returned text. */
      async declareMaterializations(source, found) {
        const path = source.startsWith("file:") ? fileURLToPath(source) : URL.canParse(source) ? undefined : source;
        if (!path) throw new Error(`Discovered steps can be declared only in a local UJG document, not ${source}`);
        const result = declareDiscoveredMaterializations(JSON.parse(await readFile(path, "utf8")), found);
        const changed = result.writes.some((write) => write.outcome !== "kept");
        return { ...(changed ? { document: `${JSON.stringify(result.document, null, 2)}\n` } : {}), writes: result.writes };
      }
    };
  }
});
