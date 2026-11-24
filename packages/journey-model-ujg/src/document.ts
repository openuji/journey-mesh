import type { JourneyPlan } from "@openuji/journey-execution-model";
import type { DiscoveredMaterialization, MaterializationWrite } from "@openuji/journey-plugin";
import type { JourneyMapDocument } from "./journey-map.js";

export type UjgNode = {
  "@id": string;
  "@type": string | string[];
  label?: string;
  [key: string]: unknown;
};

export type UjgDocument = {
  "@context": string | string[];
  "@id": string;
  "@type": string | string[];
  imports?: string[];
  nodes?: UjgNode[];
  extensions?: Record<string, unknown>;
};

export type ResolvedUjgDocumentGraph = Readonly<{
  kind: "resolved-ujg-document-graph";
  specVersion: string;
  root: UjgDocument;
  documents: readonly Readonly<{ location?: string; document: UjgDocument }>[];
  nodes: readonly UjgNode[];
  nodeSources: Readonly<Record<string, readonly string[]>>;
}>;

export type CompileUjgJourneyPlanOptions = { journeyId?: string; documentUrl?: URL | string };
export type UjgInput = UjgDocument | ResolvedUjgDocumentGraph | URL | string;

export class UjgCompileError extends Error {
  constructor(readonly code: "invalid-document" | "unsupported-feature" | "unsupported-version" | "import-error", message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = "UjgCompileError";
  }
}

export function invalid(message: string): never { throw new UjgCompileError("invalid-document", message); }
export function unsupported(message: string): never { throw new UjgCompileError("unsupported-feature", message); }
export function types(node: Pick<UjgNode, "@type">): string[] {
  return Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
}
export function snapshot<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); }
  };
  freeze(copy);
  return copy;
}

export function canonicalNode(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalNode).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalNode(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Version implementations own interpretation and lowering; the loader owns retrieval only. */
export type UjgVersionCompiler = Readonly<{
  version: string;
  parse(value: unknown): UjgDocument;
  validate(graph: ResolvedUjgDocumentGraph): void;
  compile(graph: ResolvedUjgDocumentGraph, options: CompileUjgJourneyPlanOptions): JourneyPlan;
  view(graph: ResolvedUjgDocumentGraph): JourneyMapDocument;
  /** Declare discovery findings in a document of this version; omitted by versions that cannot. */
  declareMaterializations?(document: unknown, found: readonly DiscoveredMaterialization[]): { document: UjgJsonDocument; writes: MaterializationWrite[] };
}>;

/** A UJG JSON-LD document as written to disk, edited node by node. */
export type UjgJsonDocument = Record<string, unknown> & { nodes: (Record<string, unknown> & { "@id": string })[] };
