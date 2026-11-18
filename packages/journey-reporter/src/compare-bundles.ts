import { dirname, relative, resolve } from "node:path";
import { immutableSnapshot } from "@openuji/journey-core";
import { errorToJourneyRunError, type JourneyRunError } from "@openuji/journey-runner";
import type { ComparisonPairing, ComparisonResultBundle, ComparisonSubject, SuiteResultBundle } from "@openuji/journey-plugin";
import { inferPairings, validatePairings } from "./comparison.js";
import { subjectDirectory } from "./paths.js";
import { copySuiteEvidence, publishAtomically, readReport, reportDirectory } from "./publish.js";
import { writeReportData } from "./report-writer.js";
import { defaultMaxFileBytes } from "@openuji/journey-plugin";

export type CompareBundlesInput = {
  /** Saved report directory or manifest of the baseline run. */
  baseline: string;
  /** Saved report directory or manifest of the candidate run. */
  candidate: string;
  outputDir: string;
  /** Explicit correspondence; without it, executions pair by equal test and profile IDs. */
  pairings?: readonly ComparisonPairing[];
  title?: string;
};

const sides = ["baseline", "candidate"] as const;

/**
 * Compare two saved suite runs. Nothing is executed and no plugin is loaded: the subjects'
 * registered evidence is copied below `subjects/<side>/` and the comparison is published atomically.
 * A missing or unreadable subject is reported as that subject's error, so the other side stays visible.
 */
export async function compareBundles(input: CompareBundlesInput): Promise<ComparisonResultBundle> {
  const outputDir = resolve(input.outputDir);
  const loaded = {} as Record<typeof sides[number], { path: string; bundle: SuiteResultBundle | null; errors: JourneyRunError[] }>;
  for (const side of sides) {
    const path = resolve(input[side]);
    try { loaded[side] = { path: await reportDirectory(path), bundle: await readReport(path, ["suite"]), errors: [] }; }
    catch (error) { loaded[side] = { path, bundle: null, errors: [errorToJourneyRunError(error)] }; }
  }
  const pairings = input.pairings
    ? validatePairings(input.pairings, { baseline: loaded.baseline.bundle, candidate: loaded.candidate.bundle })
    : inferPairings(loaded.baseline.bundle, loaded.candidate.bundle);
  const limits = sides.flatMap((side) => loaded[side].bundle ? [loaded[side].bundle!.storage?.maxFileBytes ?? defaultMaxFileBytes] : []);
  const maxFileBytes = limits.length ? Math.min(...limits) : defaultMaxFileBytes;
  return publishAtomically(outputDir, sides.map((side) => loaded[side].bundle ? loaded[side].path : dirname(loaded[side].path)), async (staging) => {
    const subjects = {} as Record<typeof sides[number], ComparisonSubject>;
    for (const side of sides) {
      const { path, errors } = loaded[side];
      let { bundle } = loaded[side];
      if (bundle) {
        // Each subject stays a complete report, so the comparison can link to its details.
        bundle = await copySuiteEvidence(bundle, path, resolve(staging, subjectDirectory(side)), maxFileBytes);
      }
      subjects[side] = { source: relative(outputDir, bundle ? resolve(path, "manifest.json") : path).split("\\").join("/"), ...(bundle?.label ? { label: bundle.label } : {}), bundle, errors };
    }
    const ok = sides.every((side) => !subjects[side].errors.length && subjects[side].bundle?.ok === true);
    const bundle: ComparisonResultBundle = immutableSnapshot({
      kind: "comparison", storage: { maxFileBytes }, title: input.title ?? "Journey comparison", ok, generatedAt: new Date().toISOString(),
      subjects, pairings, errors: [], artifacts: []
    });
    await writeReportData(staging, bundle);
    return bundle;
  });
}
