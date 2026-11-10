import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { JourneyArtifact, JourneyArtifactStore } from "./plugin.js";

/** A store is scoped to one test, including validation, without creating files eagerly. */
export function fileArtifactStore(directory: string): JourneyArtifactStore {
  const outputDir = resolve(directory);
  const entries = new Map<string, JourneyArtifact>();
  const outputPath = (...segments: string[]) => {
    const path = resolve(outputDir, ...segments);
    const child = relative(outputDir, path);
    if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error("Artifact path must be inside its test directory");
    return path;
  };
  return {
    outputDir, outputPath,
    get files() { return Object.freeze([...entries.values()]); },
    async attach(name, input) {
      const path = outputPath(relative(outputDir, resolve(input.path)));
      entries.set(path, Object.freeze({ name, path, href: relative(outputDir, path).split(sep).join("/"), contentType: input.contentType ?? "application/octet-stream" }));
    },
    async write({ name, data, contentType }) {
      const path = outputPath(name);
      await mkdir(resolve(path, ".."), { recursive: true });
      await writeFile(path, data);
      await this.attach(name, { path, contentType });
      return entries.get(path)!;
    },
    async read(artifact) { return readFile(outputPath(relative(outputDir, resolve(artifact.path)))); }
  };
}
export const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
