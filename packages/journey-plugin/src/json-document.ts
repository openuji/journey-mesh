import type { JourneyArtifact, JourneyArtifactStore } from "./artifacts.js";
import { byteLength, checkReportFile, ReportFileSizeError, validateReportHref } from "./report-storage.js";

export type JsonDocumentRef = Readonly<{ href: string }>;
type Entry = { kind: "inline"; value: unknown } | { kind: "ref"; ref: JsonDocumentRef };
type Document = { format: "journey-mesh/json-document"; version: 1 } & (
  | { kind: "value"; value: unknown }
  | { kind: "array"; entries: Entry[] }
  | { kind: "object"; entries: [string, Entry][] }
  | { kind: "concat"; collection: "array" | "object"; parts: JsonDocumentRef[] }
);
const envelope = { format: "journey-mesh/json-document", version: 1 } as const;

/** Pack semantic JSON values, never pieces of a JSON string. References are outside provider data. */
export async function writeJsonDocument(
  store: JourneyArtifactStore,
  input: Omit<Parameters<JourneyArtifactStore["write"]>[0], "data" | "contentType" | "storage"> & { value: unknown }
): Promise<JourneyArtifact> {
  let sequence = 0;
  const { name, value, ...metadata } = input;
  const limit = store.maxFileBytes;
  const save = (document: Document, root = false) => store.write({ ...metadata,
    name: root ? name : `${name}.parts/${sequence++}.json`, data: JSON.stringify(document), contentType: "application/json",
    ...(root ? { storage: "json-document" as const } : { auxiliary: true }) });
  function groups<T>(items: readonly T[], empty: Document, build: (items: T[]) => Document): T[][] {
    const overhead = byteLength(JSON.stringify(empty));
    const result: T[][] = []; let group: T[] = []; let size = overhead;
    for (const item of items) {
      const cost = byteLength(JSON.stringify(item));
      if (cost + overhead > limit) throw new ReportFileSizeError(name, cost + overhead, limit);
      if (group.length && size + cost + 1 > limit) { result.push(group); group = []; size = overhead; }
      size += cost + (group.length ? 1 : 0); group.push(item);
    }
    if (group.length || !items.length) result.push(group);
    // Keep the byte accounting and actual serialization at the same boundary.
    for (const entries of result) checkReportFile(name, JSON.stringify(build(entries)), limit);
    return result;
  }
  async function join(parts: JsonDocumentRef[], collection: "array" | "object", root: boolean): Promise<JourneyArtifact> {
    const document = (refs: JsonDocumentRef[]): Document => ({ ...envelope, kind: "concat", collection, parts: refs });
    while (byteLength(JSON.stringify(document(parts))) > limit) {
      const batches = groups(parts, document([]), document);
      if (batches.length >= parts.length) throw new Error(`Report limit is too small for chunk references in ${name}`);
      const next: JsonDocumentRef[] = [];
      for (const batch of batches) next.push({ href: (await save(document(batch))).href });
      parts = next;
    }
    return save(document(parts), root);
  }
  async function entry(value: unknown): Promise<Entry> {
    const inline: Entry = { kind: "inline", value };
    // Leave room for the containing object key and document envelope.
    return byteLength(JSON.stringify(inline)) <= Math.floor(limit / 2)
      ? inline : { kind: "ref", ref: { href: (await encode(value, false)).href } };
  }
  async function encode(value: unknown, root: boolean): Promise<JourneyArtifact> {
    const leaf: Document = { ...envelope, kind: "value", value };
    if (byteLength(JSON.stringify(leaf)) <= limit) return save(leaf, root);
    if (!value || typeof value !== "object") { checkReportFile(name, JSON.stringify(leaf), limit); throw new Error("Unreachable JSON size check"); }
    const parts: JsonDocumentRef[] = [];
    if (Array.isArray(value)) {
      const entries: Entry[] = [];
      for (const item of value) entries.push(await entry(item));
      const document = (entries: Entry[]): Document => ({ ...envelope, kind: "array", entries });
      for (const batch of groups(entries, document([]), document)) parts.push({ href: (await save(document(batch))).href });
      return join(parts, "array", root);
    }
    const entries: [string, Entry][] = [];
    for (const [key, item] of Object.entries(value)) entries.push([key, await entry(item)]);
    const document = (entries: [string, Entry][]): Document => ({ ...envelope, kind: "object", entries });
    for (const batch of groups(entries, document([]), document)) parts.push({ href: (await save(document(batch))).href });
    return join(parts, "object", root);
  }
  // Match JSON serialization semantics for optional properties, Dates, and array holes.
  return encode(JSON.parse(JSON.stringify(value)), true);
}

/** The same decoder is used with filesystem reads and HTTP fetches. It never loads unrelated evidence. */
export async function readJsonDocument<T = unknown>(
  read: (ref: JsonDocumentRef) => Promise<Uint8Array>, ref: JsonDocumentRef
): Promise<T> {
  const active = new Set<string>();
  async function load(ref: JsonDocumentRef): Promise<unknown> {
    validateReportHref(ref.href);
    if (active.has(ref.href)) throw new Error(`Cyclic JSON document reference: ${ref.href}`);
    active.add(ref.href);
    try {
      const document = JSON.parse(new TextDecoder().decode(await read(ref))) as Document;
      if (document?.format !== envelope.format || document.version !== 1) throw new Error(`Unsupported JSON document: ${ref.href}`);
      const unpack = (entry: Entry): Promise<unknown> => {
        if (entry?.kind === "inline" && Object.hasOwn(entry, "value")) return Promise.resolve(entry.value);
        if (entry?.kind === "ref" && entry.ref) return load(entry.ref);
        throw new Error(`Invalid JSON document entry: ${ref.href}`);
      };
      if (document.kind === "value" && Object.hasOwn(document, "value")) return document.value;
      if (document.kind === "array" && Array.isArray(document.entries)) {
        const values = []; for (const entry of document.entries) values.push(await unpack(entry)); return values;
      }
      if (document.kind === "object" && Array.isArray(document.entries)) {
        const values: [string, unknown][] = [];
        for (const [key, entry] of document.entries) { if (typeof key !== "string") throw new Error("Invalid JSON object key"); values.push([key, await unpack(entry)]); }
        return Object.fromEntries(values);
      }
      if (document.kind === "concat" && Array.isArray(document.parts)) {
        if (document.collection === "array") {
          const result: unknown[] = [];
          for (const part of document.parts) { const value = await load(part); if (!Array.isArray(value)) throw new Error("Invalid JSON array chunk"); for (const item of value) result.push(item); }
          return result;
        }
        if (document.collection === "object") {
          const result: Record<string, unknown> = {};
          for (const part of document.parts) {
            const value = await load(part); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON object chunk");
            for (const [key, item] of Object.entries(value)) Object.defineProperty(result, key, { value: item, enumerable: true, configurable: true, writable: true });
          }
          return result;
        }
      }
      throw new Error(`Invalid JSON document: ${ref.href}`);
    } finally { active.delete(ref.href); }
  }
  return await load(ref) as T;
}
