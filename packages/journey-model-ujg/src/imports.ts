import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalNode, snapshot, unsupported, UjgCompileError, type UjgNode, type UjgDocument, type UjgInput, type ResolvedUjgDocumentGraph } from "./document.js";
import { registry } from "./versions/index.js";

const resolvedGraphs = new WeakSet<object>();
type RetrievedDocument = { document: UjgDocument; location: URL };

export function assertResolvedGraph(graph: ResolvedUjgDocumentGraph): void {
  if (!resolvedGraphs.has(graph)) unsupported("Resolved document graphs must be created by loadUjgDocumentGraph");
}

export function documentLocation(input: URL | string): URL {
  const url = input instanceof URL ? new URL(input.href)
    : /^[a-z][a-z\d+.-]*:/i.test(input) ? new URL(input) : pathToFileURL(resolve(input));
  if (!["file:", "http:", "https:"].includes(url.protocol)) unsupported(`Unsupported document location: ${url.href}`);
  if (url.hash) unsupported(`Document locations with fragments are not supported: ${url.href}`);
  return url;
}

export async function readDocument(location: URL, cache = new Map<string, RetrievedDocument>(), signal = AbortSignal.timeout(30_000), redirects = 0): Promise<RetrievedDocument> {
  const known = cache.get(location.href);
  if (known) return known;
  let source: string;
  if (location.protocol === "file:") source = await readFile(location, "utf8");
  else {
    const response = await fetch(location, { signal, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const target = response.headers.get("location");
      if (!target || redirects >= 20) throw new Error(`Invalid or excessive HTTP redirects at ${location.href}`);
      const destination = documentLocation(new URL(target, location));
      if (destination.protocol === "file:") unsupported(`HTTP redirect cannot target a file: ${destination.href}`);
      const result = await readDocument(destination, cache, signal, redirects + 1);
      cache.set(location.href, result);
      return result;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status} at ${location.href}`); }
    source = await response.text();
  }
  let value: unknown;
  try { value = JSON.parse(source); }
  catch (error) { throw new UjgCompileError("invalid-document", `Invalid JSON at ${location.href}: ${String(error)}`, { cause: error }); }
  const result = { document: registry.select(value).parse(value), location };
  cache.set(location.href, result);
  return result;
}

export async function loadUjgDocumentGraph(input: UjgInput, options: { documentUrl?: URL | string } = {}): Promise<ResolvedUjgDocumentGraph> {
  if (input && typeof input === "object" && !(input instanceof URL) && "kind" in input && input.kind === "resolved-ujg-document-graph") {
    assertResolvedGraph(input);
    return input;
  }
  if (typeof input === "string" || input instanceof URL) {
    if (options.documentUrl !== undefined) unsupported("documentUrl is only supported for in-memory documents");
    const location = documentLocation(input);
    try {
      const cache = new Map<string, RetrievedDocument>();
      const root = await readDocument(location, cache);
      return await loadGraph(root.document, root.location.href, cache);
    } catch (error) { throw importFailure([location.href], error); }
  }
  return loadGraph(input as UjgDocument, options.documentUrl === undefined ? undefined : documentLocation(options.documentUrl).href);
}

async function loadGraph(rootInput: UjgDocument, rootLocation?: string, cached = new Map<string, RetrievedDocument>()): Promise<ResolvedUjgDocumentGraph> {
  const compiler = registry.select(rootInput);
  const root = compiler.parse(rootInput);
  const documents: { document: UjgDocument; location?: string }[] = [];
  const loaded = new Set<string>();
  const pending = [{ document: root, location: rootLocation, chain: [rootLocation ?? root["@id"]] }];
  // Iterative closure traversal registers a document before its imports: cycles do not await themselves.
  while (pending.length) {
    const item = pending.shift()!;
    const identity = item.location ?? item.document["@id"];
    if (loaded.has(identity)) continue;
    loaded.add(identity);
    for (const [alias, result] of cached) if (result.location.href === item.location) loaded.add(alias);
    const document = registry.select(item.document).parse(item.document);
    if (registry.select(document).version !== compiler.version) {
      throw new UjgCompileError("unsupported-version", `Import chain ${item.chain.join(" -> ")} uses another specification version`);
    }
    documents.push({ document, ...(item.location ? { location: item.location } : {}) });
    for (const ref of [...new Set(document.imports ?? [])].sort()) {
      let location: URL;
      try {
        if (!item.location && !/^[a-z][a-z\d+.-]*:/i.test(ref)) {
          unsupported(`Relative import ${ref} in ${document["@id"]} requires documentUrl`);
        }
        location = documentLocation(new URL(ref, item.location));
      } catch (error) { throw importFailure([...item.chain, ref], error); }
      if (loaded.has(location.href)) continue;
      const chain = [...item.chain, location.href];
      try {
        const result = await readDocument(location, cached);
        if (!documents.some((entry) => entry.location === result.location.href) && !pending.some((entry) => entry.location === result.location.href)) {
          pending.push({ document: result.document, location: result.location.href, chain });
        }
      } catch (error) { throw importFailure(chain, error); }
    }
  }
  const nodes = new Map<string, UjgNode>();
  const nodeSources: Record<string, string[]> = {};
  for (const { document } of documents) for (const node of document.nodes ?? []) {
    const previous = nodes.get(node["@id"]);
    if (previous && canonicalNode(previous) !== canonicalNode(node)) {
      unsupported(`Overlapping definitions of ${node["@id"]} in ${nodeSources[node["@id"]].join(", ")} and ${document["@id"]}`);
    }
    nodes.set(node["@id"], node);
    (nodeSources[node["@id"]] ??= []).push(document["@id"]);
  }
  const graph = snapshot<ResolvedUjgDocumentGraph>({
    kind: "resolved-ujg-document-graph", specVersion: compiler.version, root, documents,
    nodes: [...nodes.values()].sort((a, b) => a["@id"].localeCompare(b["@id"])), nodeSources
  });
  compiler.validate(graph);
  resolvedGraphs.add(graph);
  return graph;
}

function importFailure(chain: string[], error: unknown): UjgCompileError {
  const code = error instanceof UjgCompileError ? error.code : "import-error";
  return new UjgCompileError(code, `Import chain ${chain.join(" -> ")}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
}
