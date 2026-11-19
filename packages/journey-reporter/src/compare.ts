import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { errorToJourneyRunError, type JourneyRunError } from "@openuji/journey-runner";
import type { SuiteRun } from "@openuji/journey-run-record";
import { publishAtomically, readRunRecord, runDirectory, writeRunFiles } from "@openuji/journey-run-record/node";
import { compareMeasurements, inferPairings, validatePairings } from "./comparison.js";
import type { ReportConfig } from "./config.js";
import { buildReport } from "./report.js";
import { reportModelFormat, type ComparisonPairing, type ComparisonSubject, type ReportModel } from "./model/types.js";

export type CompareRunsInput = Readonly<{
  /** Run directory (or its run.json) of the baseline. */
  baseline: string;
  /** Run directory (or its run.json) of the candidate. */
  candidate: string;
  outputDir: string;
  /** Explicit correspondence; without it, executions pair by equal test and profile IDs. */
  pairings?: readonly ComparisonPairing[];
  title?: string;
  /** Used to build a subject's report when its run directory has none. */
  config?: ReportConfig;
  generatedAt?: string;
}>;

const sides = ["baseline", "candidate"] as const;
const exists = (path: string) => access(path).then(() => true, () => false);

/**
 * Compare two runs. Nothing is executed: each subject's run record, evidence and report are copied
 * below `subjects/<side>/`, and `report/report.json` describes the comparison. A subject that cannot
 * be read becomes that subject's error, so the other side stays visible.
 */
export async function compareRuns(input: CompareRunsInput): Promise<ReportModel> {
  const outputDir = resolve(input.outputDir);
  const loaded = {} as Record<typeof sides[number], { path: string; run: SuiteRun | null; errors: JourneyRunError[] }>;
  for (const side of sides) {
    const path = resolve(input[side]);
    try { const directory = await runDirectory(path); loaded[side] = { path: directory, run: await readRunRecord(directory), errors: [] }; }
    catch (error) { loaded[side] = { path, run: null, errors: [errorToJourneyRunError(error)] }; }
  }
  const runs = { baseline: loaded.baseline.run, candidate: loaded.candidate.run };
  const pairings = input.pairings ? validatePairings(input.pairings, runs) : inferPairings(runs.baseline, runs.candidate);
  return publishAtomically(outputDir, sides.map((side) => loaded[side].run ? loaded[side].path : dirname(loaded[side].path)), async (staging) => {
    const subjects = {} as Record<typeof sides[number], ComparisonSubject>;
    for (const side of sides) {
      const { path, run, errors } = loaded[side];
      const directory = `subjects/${side}`;
      if (run) {
        const target = resolve(staging, directory);
        await writeRunFiles(target, run, path);
        // A subject keeps the report it was published with; otherwise derive one now.
        if (await exists(resolve(path, "report/report.json"))) await cp(resolve(path, "report"), resolve(target, "report"), { recursive: true });
        else await buildReport(target, { ...(input.config ? { config: input.config } : {}) });
      }
      subjects[side] = { ...(run?.label ? { label: run.label } : {}), ok: !!run?.ok && !errors.length,
        errors: errors.map(({ name, message }) => ({ name, message })), directory: run ? directory : null };
    }
    const model: ReportModel = {
      format: reportModelFormat, version: 1, kind: "comparison", generatedAt: input.generatedAt ?? new Date().toISOString(),
      ok: sides.every((side) => subjects[side].ok), runErrors: [], errors: [], files: [], tests: [],
      comparison: { title: input.title ?? "Journey comparison", pairings, differences: compareMeasurements(pairings, runs), subjects }
    };
    await mkdir(resolve(staging, "report"), { recursive: true });
    await writeFile(resolve(staging, "report/report.json"), JSON.stringify(model));
    return model;
  });
}
