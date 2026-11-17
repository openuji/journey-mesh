import { dirname, relative, resolve } from "node:path";
import { immutableSnapshot } from "@openuji/journey-core";
import { errorToJourneyRunError, type JourneyRunError } from "@openuji/journey-runner";
import type { ComparisonPairing, ComparisonResultBundle, ComparisonSubject, SuiteResultBundle } from "@openuji/journey-plugin";
import { inferPairings, validatePairings } from "./comparison.js";
import { subjectDirectory } from "./paths.js";
import { copySuiteEvidence, publishAtomically, readSavedBundle, writeReport } from "./publish.js";

export type CompareBundlesInput = {
  /** Saved suite `bundle.json` of the baseline run. */
  baseline: string;
  /** Saved suite `bundle.json` of the candidate run. */
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
    try { loaded[side] = { path, bundle: await readSavedBundle(path, ["suite"]), errors: [] }; }
    catch (error) { loaded[side] = { path, bundle: null, errors: [errorToJourneyRunError(error)] }; }
  }
  const pairings = input.pairings
    ? validatePairings(input.pairings, { baseline: loaded.baseline.bundle, candidate: loaded.candidate.bundle })
    : inferPairings(loaded.baseline.bundle, loaded.candidate.bundle);
  return publishAtomically(outputDir, sides.map((side) => dirname(loaded[side].path)), async (staging) => {
    const subjects = {} as Record<typeof sides[number], ComparisonSubject>;
    for (const side of sides) {
      const { path, bundle, errors } = loaded[side];
      if (bundle) await copySuiteEvidence(bundle, dirname(path), resolve(staging, subjectDirectory(side)));
      subjects[side] = { source: relative(outputDir, path).split("\\").join("/"), ...(bundle?.label ? { label: bundle.label } : {}), bundle, errors };
    }
    const ok = sides.every((side) => !subjects[side].errors.length && subjects[side].bundle?.ok === true);
    const bundle: ComparisonResultBundle = immutableSnapshot({
      kind: "comparison", title: input.title ?? "Journey comparison", ok, generatedAt: new Date().toISOString(),
      subjects, pairings, errors: [], artifacts: []
    });
    await writeReport(staging, bundle);
    return bundle;
  });
}
