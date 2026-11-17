import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { JourneyArtifact, JourneyArtifactStore } from "@openuji/journey-plugin";

/**
 * Files below `root/prefix`, registered with hrefs relative to `root`. Nothing is created until written,
 * so validation never touches the output directory. Paths may not escape the store.
 */
export function fileArtifactStore(root: string, prefix = ""): JourneyArtifactStore {
  const base = resolve(root);
  const directory = resolve(base, prefix);
  const entries = new Map<string, JourneyArtifact>();
  const inside = (parent: string, path: string) => {
    const child = relative(parent, path);
    return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
  };
  const href = (path: string) => relative(base, path).split(sep).join("/");
  return {
    get files() { return Object.freeze([...entries.values()]); },
    async write({ name, data, contentType, scope }) {
      const path = resolve(directory, name);
      if (!inside(directory, path)) throw new Error("Artifact path must be inside its test directory");
      await mkdir(resolve(path, ".."), { recursive: true });
      await writeFile(path, data);
      const artifact: JourneyArtifact = Object.freeze({ name, href: href(path), contentType, ...(scope ? { scope: Object.freeze({ ...scope }) } : {}) });
      entries.set(artifact.href, artifact);
      return artifact;
    },
    async read(artifact) {
      const path = resolve(base, artifact.href);
      if (!inside(base, path)) throw new Error("Artifact path must be inside its store");
      return readFile(path);
    }
  };
}
