import { access, mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { JourneyArtifact, SuiteResultBundle, ComparisonResultBundle, JsonDocumentRef } from "@openuji/journey-plugin";
import { checkReportFile, defaultMaxFileBytes, readJsonDocument, writeJsonDocument, validateReportHref } from "@openuji/journey-plugin";
import { fileArtifactStore } from "./artifact-store.js";
import { openReport, materializeReport } from "./report-data.js";
import { writeReportData } from "./report-writer.js";
import { subjectDirectory, testDirectory } from "./paths.js";
import { viteAssets } from "./vite-assets.js";
import { withJourneyMapErrors } from "./journey-maps.js";
import { testPassed } from "./outcome.js";

/** A saved bundle that can be published: a suite run or a comparison of two suite runs. */
export type PublishedBundle = SuiteResultBundle | ComparisonResultBundle;

function checkedSuite(bundle: SuiteResultBundle): SuiteResultBundle {
  const tests = bundle.tests.map(withJourneyMapErrors);
  return { ...bundle, tests, ok: bundle.ok && tests.every(testPassed) };
}

function checkedBundle(bundle: PublishedBundle): PublishedBundle {
  if (bundle.kind === "suite") return checkedSuite(bundle);
  const subjects = Object.fromEntries((["baseline", "candidate"] as const).map((side) => {
    const subject = bundle.subjects[side];
    return [side, { ...subject, bundle: subject.bundle ? checkedSuite(subject.bundle) : null }];
  })) as ComparisonResultBundle["subjects"];
  return { ...bundle, subjects, ok: bundle.ok && !!subjects.baseline.bundle?.ok && !!subjects.candidate.bundle?.ok };
}

const inside = (root: string, path: string) => {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

/** Resolve the sole supported disk entry point. */
export async function reportDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  if ((await stat(absolute)).isDirectory()) return absolute;
  if (absolute.split(sep).pop() !== "manifest.json") throw new Error("Expected manifest.json or a report directory; legacy bundle.json reports must be regenerated.");
  return dirname(absolute);
}

function safeReader(directory: string) {
  let root: Promise<string> | undefined;
  return async (ref: JsonDocumentRef): Promise<Uint8Array> => {
    validateReportHref(ref.href);
    const base = await (root ??= realpath(directory));
    const source = await realpath(resolve(directory, ref.href));
    if (!inside(base, source)) throw new Error("Artifact escapes saved evidence directory");
    return readFile(source);
  };
}

/** Published HTML contains only the application shell. Data is fetched from the manifest. */
export async function viewerHtml(_bundle?: PublishedBundle): Promise<string> {
  const asset = (await viteAssets(new URL("../dist/app/", import.meta.url))).find((item) => item.name === "index.html");
  if (!asset) throw new Error("Viewer index.html is missing. Run pnpm build.");
  return new TextDecoder().decode(asset.data);
}

export async function writeReport(outputDir: string, bundle: PublishedBundle): Promise<void> {
  const source = resolve(outputDir);
  await mkdir(source, { recursive: true });
  await publishAtomically(source, [source], (staging) => publishBundle(source, bundle, staging), true);
}

export async function readReport<K extends PublishedBundle["kind"] = PublishedBundle["kind"]>(
  path: string, kinds: readonly K[] = ["suite", "comparison"] as K[]
): Promise<Extract<PublishedBundle, { kind: K }>> {
  const directory = await reportDirectory(path);
  const bundle = await materializeReport(await openReport(safeReader(directory)));
  if (!kinds.includes(bundle.kind as K)) throw new Error(`Expected a Journey Mesh ${kinds.join(" or ")} report: ${path}`);
  return checkedBundle(bundle) as Extract<PublishedBundle, { kind: K }>;
}

async function copyArtifacts(artifacts: readonly JourneyArtifact[], source: string, target: string, limit: number): Promise<readonly JourneyArtifact[]> {
  const read = safeReader(source);
  const store = fileArtifactStore(target, "", limit);
  const documents = artifacts.filter((item) => item.storage === "json-document");
  for (const artifact of artifacts) {
    validateReportHref(artifact.href);
    if (documents.some((root) => artifact.href.startsWith(`${root.href}.parts/`))) continue;
    if (artifact.storage === "json-document") {
      await writeJsonDocument(store, { name: artifact.href, value: await readJsonDocument(read, artifact), scope: artifact.scope, label: artifact.label });
    } else {
      const data = await read(artifact);
      checkReportFile(artifact.href, data, limit);
      await store.write({ ...artifact, name: artifact.href, data });
    }
  }
  const names = new Map(artifacts.map((artifact) => [artifact.href, artifact.name]));
  return store.files.map((artifact) => ({ ...artifact, name: names.get(artifact.href) ?? artifact.name }));
}

/** Repack structured evidence under the output policy; opaque artifacts must already fit. */
export async function copySuiteEvidence(suite: SuiteResultBundle, source: string, target: string, limit = suite.storage?.maxFileBytes ?? defaultMaxFileBytes): Promise<SuiteResultBundle> {
  const artifacts = await copyArtifacts(suite.artifacts, source, target, limit);
  const tests = [];
  for (const test of suite.tests) {
    const directory = testDirectory(test.id);
    tests.push({ ...test, artifacts: await copyArtifacts(test.artifacts, resolve(source, directory), resolve(target, directory), limit) });
  }
  return { ...suite, storage: { maxFileBytes: limit }, artifacts, tests };
}

/** Build a publication in a sibling staging directory and replace `destination` only after it fully succeeded. */
export async function publishAtomically<T>(destination: string, sources: readonly string[], build: (staging: string) => Promise<T>, replaceSource = false): Promise<T> {
  const target = resolve(destination);
  for (const source of sources.map((item) => resolve(item))) {
    if ((!replaceSource && source === target) || inside(target, source)) throw new Error("Publication cannot replace a directory that contains its saved bundle");
  }
  for (const marker of ["package.json", ".git"]) {
    if (await access(resolve(target, marker)).then(() => true, () => false)) throw new Error("Publication cannot replace a source workspace");
  }
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), ".journey-report-"));
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

/**
 * Republish a saved bundle with only its registered evidence and the viewer.
 * Rendering in place refreshes the viewer; no journey, observer, or application code is loaded.
 */
export async function publishReport(path: string, outputDir?: string): Promise<PublishedBundle> {
  const source = await reportDirectory(path);
  const original = await readReport(source);
  const destination = outputDir ?? source;
  return publishAtomically(destination, [source], (staging) => publishBundle(source, original, staging), true);
}

async function publishBundle(source: string, original: PublishedBundle, staging: string): Promise<PublishedBundle> {
  const limit = original.storage?.maxFileBytes ?? defaultMaxFileBytes;
  let bundle = checkedBundle(original);
  if (bundle.kind === "suite") bundle = await copySuiteEvidence(bundle, source, staging, limit);
  else {
    const subjects = { ...bundle.subjects };
    for (const side of ["baseline", "candidate"] as const) {
      const subject = subjects[side];
      if (!subject.bundle) continue;
      subjects[side] = { ...subject, bundle: await copySuiteEvidence(subject.bundle,
        resolve(source, subjectDirectory(side)), resolve(staging, subjectDirectory(side)), limit) };
    }
    bundle = { ...bundle, subjects, artifacts: await copyArtifacts(bundle.artifacts, source, staging, limit) };
  }
  await writeReportData(staging, bundle);
  return bundle;
}
