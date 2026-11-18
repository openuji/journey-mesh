import { access, copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { JourneyArtifact, SuiteResultBundle, ComparisonResultBundle } from "@openuji/journey-plugin";
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

const evidenceTypes = new Set(["application/json", "text/html", "image/png", "application/xml", "text/plain"]);

const inside = (root: string, path: string) => {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

const text = (data: Uint8Array) => new TextDecoder().decode(data);

/**
 * The viewer as one self-contained HTML page: app script, styles and the bundle are inlined, so the
 * report opens from disk (`file://`) as well as over HTTP. Browsers refuse module scripts and `fetch`
 * from `file://`, which is why nothing here is loaded from a separate file.
 */
export async function viewerHtml(bundle: PublishedBundle): Promise<string> {
  bundle = checkedBundle(bundle);
  const assets = await viteAssets(new URL("../dist/app/", import.meta.url));
  const asset = (name: string) => {
    const found = assets.find((item) => item.name === name);
    if (!found) throw new Error(`Viewer asset ${name} is missing. Run pnpm build.`);
    return text(found.data);
  };
  let html = asset("index.html")
    .replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_match, name: string) => {
      const code = asset(name);
      if (code.includes("<!--")) throw new Error(`Viewer script ${name} cannot be inlined safely`);
      return `<script type="module">${code.replace(/<\/script/gi, "<\\/script")}</script>`;
    })
    .replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_match, name: string) => `<style>${asset(name).replace(/<\/style/gi, "<\\/style")}</style>`);
  if (/(?:src|href)="\.\/assets\//.test(html)) throw new Error("Viewer still references external assets");
  // `<` is escaped so no string in the bundle can close the script element.
  const data = `<script>window.__JOURNEY_MESH_BUNDLE__=${JSON.stringify(bundle).replace(/</g, "\\u003c")};</script>`;
  html = html.replace("</head>", () => `${data}\n</head>`);
  return html;
}

/** The only writer of `bundle.json` and the report page that renders it. */
export async function writeReport(outputDir: string, bundle: PublishedBundle): Promise<void> {
  bundle = checkedBundle(bundle);
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "bundle.json"), JSON.stringify(bundle, null, 2));
  await writeFile(resolve(outputDir, "index.html"), await viewerHtml(bundle));
}

export async function readSavedBundle<K extends PublishedBundle["kind"]>(path: string, kinds: readonly K[]): Promise<Extract<PublishedBundle, { kind: K }>> {
  const bundle = JSON.parse(await readFile(path, "utf8")) as PublishedBundle | null;
  if (!bundle || !kinds.includes(bundle.kind as K)) throw new Error(`Expected a Journey Mesh ${kinds.join(" or ")} bundle: ${path}`);
  return checkedBundle(bundle) as Extract<PublishedBundle, { kind: K }>;
}

/** Copy one registered artifact; hrefs must stay relative and inside the saved evidence directory. */
async function copyArtifact(artifact: JourneyArtifact, from: string, to: string): Promise<void> {
  if (!evidenceTypes.has(artifact.contentType)) return;
  if (isAbsolute(artifact.href) || artifact.href.split(/[\\/]/).some((part) => part === ".." || part === "." || !part)) throw new Error("Artifact href must be a relative evidence path");
  const root = await realpath(from);
  const source = await realpath(resolve(from, artifact.href));
  if (!inside(root, source)) throw new Error("Artifact escapes saved evidence directory");
  const target = resolve(to, artifact.href);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

/** Copy a suite's registered evidence from its saved directory into `target`, keeping the suite layout. */
export async function copySuiteEvidence(suite: SuiteResultBundle, source: string, target: string): Promise<void> {
  for (const artifact of suite.artifacts) await copyArtifact(artifact, source, target);
  for (const test of suite.tests) {
    const directory = testDirectory(test.id);
    for (const artifact of test.artifacts) await copyArtifact(artifact, resolve(source, directory), resolve(target, directory));
  }
}

/** Build a publication in a sibling staging directory and replace `destination` only after it fully succeeded. */
export async function publishAtomically<T>(destination: string, sources: readonly string[], build: (staging: string) => Promise<T>): Promise<T> {
  const target = resolve(destination);
  for (const source of sources.map((item) => resolve(item))) {
    if (source === target || inside(target, source)) throw new Error("Publication cannot replace a directory that contains its saved bundle");
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
export async function publishReport(path: string, outputDir = dirname(resolve(path))): Promise<PublishedBundle> {
  const source = dirname(resolve(path));
  const bundle = await readSavedBundle(path, ["suite", "comparison"]);
  if (resolve(outputDir) === source) { await writeReport(source, bundle); return bundle; }
  return publishAtomically(outputDir, [source], async (staging) => {
    if (bundle.kind === "suite") await copySuiteEvidence(bundle, source, staging);
    else {
      for (const side of ["baseline", "candidate"] as const) {
        const subject = bundle.subjects[side].bundle;
        if (!subject) continue;
        await copySuiteEvidence(subject, resolve(source, subjectDirectory(side)), resolve(staging, subjectDirectory(side)));
        await writeReport(resolve(staging, subjectDirectory(side)), subject);
      }
      for (const artifact of bundle.artifacts) await copyArtifact(artifact, source, staging);
    }
    await writeReport(staging, bundle);
    return bundle;
  });
}
