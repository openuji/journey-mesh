/**
 * Writes one bundle per finding, and an index of them. A finding is an operation that failed in the run,
 * so everything in a bundle comes from what the run captured.
 */
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Finding } from "@openuji/journey-report-findings";
import { indexEntry, indexMarkdown, issueMarkdown, type BundleFiles, type IndexEntry, type IssueContext } from "./document.js";
import type { LoadedFindings, RunFileReader } from "./load.js";
import type { Renderer } from "./render.js";

export type BundleInput = Readonly<{
  loaded: LoadedFindings;
  read: RunFileReader;
  out: string;
  renderer: Renderer;
  /** Write only this finding's bundle; the index still lists every finding. */
  only?: string;
  imageBaseUrl?: string;
}>;

export type BundleResult = Readonly<{
  bundles: readonly Readonly<{ id: string; issue: string }>[];
  index: string;
}>;

/** A directory name for a finding id, so nothing in an id may leave `out`. */
export const bundleDirectory = (id: string) => (/^\.*$/.test(id) ? "_" : id.replace(/[^A-Za-z0-9._-]/g, "_"));

export async function writeBundles(input: BundleInput): Promise<BundleResult> {
  const { loaded, read, out, renderer, only } = input;
  const context: IssueContext = {
    ...(loaded.model.target ? { target: loaded.model.target } : {}),
    ...(input.imageBaseUrl ? { imageBaseUrl: input.imageBaseUrl } : {}),
    generatedAt: loaded.model.finishedAt ?? loaded.model.generatedAt
  };
  const bundles: { id: string; issue: string }[] = [];
  const entries: IndexEntry[] = [];
  await mkdir(out, { recursive: true });

  for (const finding of loaded.reports.flatMap((report) => report.findings)) {
    const directory = bundleDirectory(finding.id);
    const selected = !only || only === finding.id;
    if (selected) {
      await writeBundle(finding, join(out, directory), read, renderer, context);
      bundles.push({ id: finding.id, issue: join(out, directory, "issue.md") });
    }
    // With --finding, another finding is linked only when an earlier run of this command wrote its bundle.
    const linked = selected || await exists(join(out, directory, "evidence.json"));
    entries.push(indexEntry(finding, linked ? `${directory}/issue.md` : undefined));
  }

  const index = join(out, "index.md");
  await writeFile(index, indexMarkdown(entries, context));
  return { bundles, index };
}

async function writeBundle(finding: Finding, directory: string, read: RunFileReader, renderer: Renderer, context: IssueContext): Promise<void> {
  // The directory is replaced, so only ever replace one this tool wrote.
  if (await exists(directory) && !await exists(join(directory, "evidence.json"))) {
    throw new Error(`${directory} exists and is not a finding bundle; choose another --out`);
  }
  const images: Record<string, Uint8Array> = {};
  for (const frame of finding.frames) images[frame.key] = await read(frame.screenshot);
  // A finding whose screenshot could not be taken is still a finding: its text stands alone.
  const annotated = finding.frames.length ? await renderer.annotate(finding.frames, images) : undefined;
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const files: BundleFiles = {
    ...(annotated ? { annotated: "annotated.png" } : {}),
    frames: finding.frames.map((frame) => ({ key: frame.key, file: `${frame.key}.png`, label: frame.label }))
  };
  for (const frame of files.frames) await writeFile(join(directory, frame.file), images[frame.key]!);
  if (annotated) await writeFile(join(directory, "annotated.png"), annotated);
  await writeFile(join(directory, "issue.md"), issueMarkdown(finding, files, context));
  await writeFile(join(directory, "evidence.json"), `${JSON.stringify({ finding, environment: context }, null, 2)}\n`);
}

const exists = (path: string) => access(path).then(() => true, () => false);
