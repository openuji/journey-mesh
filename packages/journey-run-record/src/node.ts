import { access, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { JourneyArtifact, JourneyArtifactStore } from "@openuji/journey-plugin";
import { testRecordHref, validateHref } from "./paths.js";
import { loadSuiteRun, type RunReader } from "./read.js";
import { runRecordFormat, type EvidenceFile, type RunRecord, type SuiteRun } from "./types.js";

export * from "./index.js";

const inside = (root: string, path: string) => {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

/**
 * Evidence files below `root/prefix`, registered with hrefs relative to `root` (the run directory).
 * Nothing is created until written, so validation never touches the output directory.
 */
export function fileEvidenceStore(root: string, prefix = ""): JourneyArtifactStore {
  const base = resolve(root);
  const directory = resolve(base, prefix);
  const entries = new Map<string, JourneyArtifact>();
  const href = (path: string) => relative(base, path).split(sep).join("/");
  return {
    get files() { return Object.freeze([...entries.values()]); },
    async write({ name, data, contentType, scope, format }) {
      const path = resolve(directory, name);
      if (!inside(directory, path)) throw new Error("Evidence path must stay inside its store");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
      const artifact: JourneyArtifact = Object.freeze({ name, href: href(path), contentType,
        ...(scope ? { scope: Object.freeze({ ...scope }) } : {}), ...(format ? { format } : {}) });
      entries.set(artifact.href, artifact);
      return artifact;
    },
    async read(artifact) {
      const path = resolve(base, artifact.href);
      if (!inside(base, path)) throw new Error("Evidence path must stay inside its store");
      return readFile(path);
    }
  };
}

/** Read files of a run directory; references cannot escape it, including through symlinks. */
export function runReader(directory: string): RunReader {
  let root: Promise<string> | undefined;
  return async (href) => {
    validateHref(href);
    const base = await (root ??= realpath(directory));
    const source = await realpath(resolve(directory, href));
    if (!inside(base, source)) throw new Error("Reference escapes the run directory");
    return readFile(source);
  };
}

/** Accept a run directory or its `run.json`. */
export async function runDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  if ((await stat(absolute)).isDirectory()) return absolute;
  if (absolute.split(sep).pop() !== "run.json") throw new Error("Expected a run directory or its run.json");
  return dirname(absolute);
}

export async function readRunRecord(path: string): Promise<SuiteRun> {
  return loadSuiteRun(runReader(await runDirectory(path)));
}

/**
 * Build `destination` in a sibling staging directory and replace it only after `build` succeeded.
 * A failed build leaves the existing destination untouched.
 */
export async function publishAtomically<T>(destination: string, sources: readonly string[], build: (staging: string) => Promise<T>, replaceSource = false): Promise<T> {
  const target = resolve(destination);
  for (const source of sources.map((item) => resolve(item))) {
    if ((!replaceSource && source === target) || inside(target, source)) throw new Error("Publication cannot replace a directory that contains its source");
  }
  for (const marker of ["package.json", ".git"]) {
    if (await access(resolve(target, marker)).then(() => true, () => false)) throw new Error("Publication cannot replace a source workspace");
  }
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), ".journey-staging-"));
  const backup = `${staging}.previous`;
  let moved = false;
  try {
    const result = await build(staging);
    try { await rename(target, backup); moved = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    try { await rename(staging, target); }
    catch (error) { if (moved) await rename(backup, target); throw error; }
    if (moved) await rm(backup, { recursive: true, force: true });
    return result;
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

/** Copy registered files between run directories. Unregistered files are never published. */
export async function copyEvidence(files: readonly EvidenceFile[], source: string, target: string): Promise<void> {
  const read = runReader(source);
  for (const file of files) {
    validateHref(file.href);
    const path = resolve(target, file.href);
    if (!inside(resolve(target), path)) throw new Error("Reference escapes the run directory");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, await read(file.href));
  }
}

async function writeJson(directory: string, href: string, value: unknown): Promise<void> {
  validateHref(href);
  const path = resolve(directory, href);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

/** Write the records into `target` next to copies of the registered evidence in `source`. `run.json` is written last. */
export async function writeRunFiles(target: string, run: SuiteRun, source: string): Promise<void> {
  await copyEvidence([...run.files, ...run.tests.flatMap((test) => test.files)], source, target);
  for (const test of run.tests) await writeJson(target, testRecordHref(test.id), test);
  const { tests, ...summary } = run;
  const record: RunRecord = { format: runRecordFormat, version: 1, ...summary,
    tests: tests.map((test) => ({ id: test.id, ok: test.ok, href: testRecordHref(test.id) })) };
  await writeJson(target, "run.json", record);
}

/**
 * Publish a finished run: its records and every registered evidence file already written below
 * `outputDir`. Unregistered and stale files, including derived reports, are removed.
 */
export async function writeRunRecord(outputDir: string, run: SuiteRun): Promise<void> {
  const target = resolve(outputDir);
  await mkdir(target, { recursive: true });
  await publishAtomically(target, [target], (staging) => writeRunFiles(staging, run, target), true);
}
