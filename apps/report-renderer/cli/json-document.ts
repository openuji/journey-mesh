/**
 * This app's hosting policy for static sites: a file size limit, and JSON documents split into linked
 * chunks when they exceed it. Run records and report models are always written whole; only `site` applies
 * this, and the viewer reassembles chunks with `src/json-document.ts`.
 */
export const defaultMaxFileBytes = 5 * 1024 * 1024;
export const jsonDocumentFormat = "journey-mesh/json-document";

export function reportFileLimit(maxFileSizeMiB: unknown = 5): number {
  const bytes = typeof maxFileSizeMiB === "number" ? Math.floor(maxFileSizeMiB * 1024 * 1024) : NaN;
  if (!Number.isFinite(maxFileSizeMiB) || !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error("--max-file-size-mib must resolve to a positive safe byte count");
  return bytes;
}

export class ReportFileSizeError extends Error {
  constructor(readonly file: string, readonly bytes: number, readonly maxFileBytes: number) {
    super(`Site file ${file} is ${bytes} bytes; the limit is ${maxFileBytes} bytes. Split the document or increase --max-file-size-mib.`);
    this.name = "ReportFileSizeError";
  }
}

export const byteLength = (data: string | Uint8Array): number => typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
export function checkReportFile(name: string, data: string | Uint8Array, maxFileBytes: number): void {
  const bytes = byteLength(data);
  if (bytes > maxFileBytes) throw new ReportFileSizeError(name, bytes, maxFileBytes);
}

/** Part references are relative to the directory of the root document. */
type Ref = Readonly<{ href: string }>;
type Entry = { kind: "inline"; value: unknown } | { kind: "ref"; ref: Ref };
type Document = { format: typeof jsonDocumentFormat; version: 1 } & (
  | { kind: "value"; value: unknown }
  | { kind: "array"; entries: Entry[] }
  | { kind: "object"; entries: [string, Entry][] }
  | { kind: "concat"; collection: "array" | "object"; parts: Ref[] }
);
const envelope = { format: jsonDocumentFormat, version: 1 } as const;

export type ChunkWriter = Readonly<{ maxFileBytes: number; write(name: string, data: string): Promise<void> }>;

/**
 * Write `value` at `name` within `maxFileBytes` per file. Semantic JSON values are packed, never pieces
 * of a JSON string. Parts live below `<name>.parts/`. The viewer reads them back with `src/json-document.ts`.
 */
export async function writeJsonDocument(store: ChunkWriter, name: string, value: unknown): Promise<void> {
  let sequence = 0;
  const limit = store.maxFileBytes;
  const base = name.split("/").pop()!;
  const save = async (document: Document, root = false): Promise<Ref> => {
    const part = `${sequence++}.json`;
    await store.write(root ? name : `${name}.parts/${part}`, JSON.stringify(document));
    return { href: `${base}.parts/${part}` };
  };
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
  async function join(parts: Ref[], collection: "array" | "object", root: boolean): Promise<Ref> {
    const document = (refs: Ref[]): Document => ({ ...envelope, kind: "concat", collection, parts: refs });
    while (byteLength(JSON.stringify(document(parts))) > limit) {
      const batches = groups(parts, document([]), document);
      if (batches.length >= parts.length) throw new Error(`Report limit is too small for chunk references in ${name}`);
      const next: Ref[] = [];
      for (const batch of batches) next.push(await save(document(batch)));
      parts = next;
    }
    return save(document(parts), root);
  }
  async function entry(value: unknown): Promise<Entry> {
    const inline: Entry = { kind: "inline", value };
    // Leave room for the containing object key and document envelope.
    return byteLength(JSON.stringify(inline)) <= Math.floor(limit / 2) ? inline : { kind: "ref", ref: await encode(value, false) };
  }
  async function encode(value: unknown, root: boolean): Promise<Ref> {
    const leaf: Document = { ...envelope, kind: "value", value };
    if (byteLength(JSON.stringify(leaf)) <= limit) return save(leaf, root);
    if (!value || typeof value !== "object") { checkReportFile(name, JSON.stringify(leaf), limit); throw new Error("Unreachable JSON size check"); }
    const parts: Ref[] = [];
    if (Array.isArray(value)) {
      const entries: Entry[] = [];
      for (const item of value) entries.push(await entry(item));
      const document = (entries: Entry[]): Document => ({ ...envelope, kind: "array", entries });
      for (const batch of groups(entries, document([]), document)) parts.push(await save(document(batch)));
      return join(parts, "array", root);
    }
    const entries: [string, Entry][] = [];
    for (const [key, item] of Object.entries(value)) entries.push([key, await entry(item)]);
    const document = (entries: [string, Entry][]): Document => ({ ...envelope, kind: "object", entries });
    for (const batch of groups(entries, document([]), document)) parts.push(await save(document(batch)));
    return join(parts, "object", root);
  }
  // Match JSON serialization semantics for optional properties, Dates, and array holes.
  await encode(JSON.parse(JSON.stringify(value)), true);
}
