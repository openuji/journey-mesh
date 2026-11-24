import { unsupported, UjgCompileError, type UjgDocument, type UjgInput, type ResolvedUjgDocumentGraph, type CompileUjgJourneyPlanOptions } from "./document.js";
import { documentLocation, readDocument, loadUjgDocumentGraph, assertResolvedGraph } from "./imports.js";
import { registry } from "./versions/index.js";

export type { UjgNode, UjgDocument, UjgInput, ResolvedUjgDocumentGraph, CompileUjgJourneyPlanOptions } from "./document.js";
export { UjgCompileError } from "./document.js";
export { loadUjgDocumentGraph } from "./imports.js";
export { declareDiscoveredMaterializations } from "./materializations.js";
export type { UjgJsonDocument } from "./document.js";
export type { JourneyMapDocument } from "./journey-map.js";

/** Parse a single document; reference validation requires its import closure. */
export function parseUjgDocument(source: string): UjgDocument {
  let value: unknown;
  try { value = JSON.parse(source); }
  catch (error) { throw new UjgCompileError("invalid-document", `Invalid JSON: ${String(error)}`, { cause: error }); }
  return registry.select(value).parse(value);
}

/** Retrieve one document. Use loadUjgDocumentGraph to resolve its imports. */
export async function loadUjgDocument(input: URL | string): Promise<UjgDocument> {
  return (await readDocument(documentLocation(input))).document;
}

export async function compileUjgJourneyPlan(input: UjgInput, options: CompileUjgJourneyPlanOptions = {}) {
  const graph = await loadUjgDocumentGraph(input, options);
  return registry.select(graph.root).compile(graph, options);
}

/** Project the same validated import snapshot that supplies compilation. */
export function toJourneyMapDocument(input: UjgDocument | ResolvedUjgDocumentGraph) {
  if ("kind" in input && input.kind === "resolved-ujg-document-graph") {
    assertResolvedGraph(input);
    const compiler = registry.select(input.root);
    compiler.validate(input);
    return compiler.view(input);
  }
  const compiler = registry.select(input);
  const document = compiler.parse(input);
  if (document.imports?.length) unsupported("Map projection of imports requires loadUjgDocumentGraph first");
  const graph: ResolvedUjgDocumentGraph = {
    kind: "resolved-ujg-document-graph", specVersion: compiler.version, root: document,
    documents: [{ document }], nodes: document.nodes ?? [], nodeSources: {}
  };
  compiler.validate(graph);
  return compiler.view(graph);
}
