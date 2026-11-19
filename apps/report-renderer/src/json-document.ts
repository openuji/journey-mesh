import { validateHref } from "@openuji/journey-run-record";

/** Reads bytes of a file of the served directory; `href` is relative to it. */
export type ByteReader = (href: string) => Promise<Uint8Array>;

const jsonDocumentFormat = "journey-mesh/json-document";
type Ref = { href: string };
type Entry = { kind: "inline"; value: unknown } | { kind: "ref"; ref: Ref };
type Document = { format: string; version: number; kind: string; value?: unknown; entries?: unknown[]; collection?: string; parts?: Ref[] };

const parse = async (read: ByteReader, href: string): Promise<unknown> => {
  validateHref(href);
  return JSON.parse(new TextDecoder().decode(await read(href)));
};
const directoryOf = (href: string) => href.includes("/") ? href.slice(0, href.lastIndexOf("/") + 1) : "";

/**
 * Read a JSON file of a published site. `site` may have split a large file into linked chunks
 * (`format: "journey-mesh/json-document"`, see cli/json-document.ts); those are reassembled transparently.
 */
export async function readJson<T = unknown>(read: ByteReader, href: string): Promise<T> {
  const root = await parse(read, href) as Document;
  if (root?.format !== jsonDocumentFormat) return root as T;
  const base = directoryOf(href);
  const active = new Set<string>();
  async function decode(document: Document, at: string): Promise<unknown> {
    if (document?.format !== jsonDocumentFormat || document.version !== 1) throw new Error(`Unsupported JSON document: ${at}`);
    const unpack = (entry: Entry): Promise<unknown> => {
      if (entry?.kind === "inline" && Object.hasOwn(entry, "value")) return Promise.resolve(entry.value);
      if (entry?.kind === "ref" && entry.ref) return load(entry.ref);
      throw new Error(`Invalid JSON document entry: ${at}`);
    };
    if (document.kind === "value" && Object.hasOwn(document, "value")) return document.value;
    if (document.kind === "array" && Array.isArray(document.entries)) {
      const values = []; for (const entry of document.entries as Entry[]) values.push(await unpack(entry)); return values;
    }
    if (document.kind === "object" && Array.isArray(document.entries)) {
      const values: [string, unknown][] = [];
      for (const [key, entry] of document.entries as [string, Entry][]) { if (typeof key !== "string") throw new Error("Invalid JSON object key"); values.push([key, await unpack(entry)]); }
      return Object.fromEntries(values);
    }
    if (document.kind === "concat" && Array.isArray(document.parts)) {
      if (document.collection === "array") {
        const result: unknown[] = [];
        for (const part of document.parts) { const value = await load(part); if (!Array.isArray(value)) throw new Error("Invalid JSON array chunk"); result.push(...value); }
        return result;
      }
      if (document.collection === "object") {
        const result: Record<string, unknown> = {};
        for (const part of document.parts) {
          const value = await load(part);
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON object chunk");
          for (const [key, item] of Object.entries(value)) Object.defineProperty(result, key, { value: item, enumerable: true, configurable: true, writable: true });
        }
        return result;
      }
    }
    throw new Error(`Invalid JSON document: ${at}`);
  }
  async function load(ref: Ref): Promise<unknown> {
    const href = base + ref.href;
    if (active.has(href)) throw new Error(`Cyclic JSON document reference: ${href}`);
    active.add(href);
    try { return await decode(await parse(read, href) as Document, href); } finally { active.delete(href); }
  }
  return await decode(root, href) as T;
}
