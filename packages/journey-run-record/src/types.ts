import type { JourneyObserverOutput } from "@openuji/journey-core";
import type { JourneyPlan } from "@openuji/journey-execution-model";
import type { JourneyRunError, RunResult } from "@openuji/journey-runner";
import type { JourneyArtifact, SourceIdentity } from "@openuji/journey-plugin";

export const runRecordFormat = "journey-mesh/run";
export const testRecordFormat = "journey-mesh/run/test";
/**
 * The format version written today. Version 2 renamed the executing component from `adapter` to
 * `executor`; the reader still accepts version 1 and normalizes it (see `legacy.ts`).
 */
export const runRecordVersion = 2;

/** A file registered during a run. `href` is relative to the run directory. */
export type EvidenceFile = JourneyArtifact;
/** One configured journey of a test, the executor that ran it, and the key of its model snapshot. */
export type JourneySegment = Readonly<{ id: string; journeyId: string; executor: string; view?: string }>;
/** A snapshot of the journey model document a test was compiled from, recorded with the run. */
export type JourneyView = Readonly<{ format: string; document: unknown }>;

/** Everything one test executed and observed. No presentation data and no report options. */
export type TestRecord = Readonly<{
  format: typeof testRecordFormat;
  version: typeof runRecordVersion;
  id: string;
  /** The verdict: see `testPassed`. */
  ok: boolean;
  segments: readonly JourneySegment[];
  views: Readonly<Record<string, JourneyView>>;
  plan: JourneyPlan;
  result: RunResult;
  observers: readonly JourneyObserverOutput[];
  /**
   * Observer outputs that failed or were invalid (their evidence is missing from `observers`), and what
   * observers threw while the test ran.
   */
  observerErrors: readonly JourneyRunError[];
  files: readonly EvidenceFile[];
}>;

export type TestEntry = Readonly<{ id: string; ok: boolean; href: string }>;

/** The index of a run directory (`run.json`). */
export type RunRecord = Readonly<{
  format: typeof runRecordFormat;
  version: typeof runRecordVersion;
  label?: string;
  target?: SourceIdentity;
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  errors: readonly JourneyRunError[];
  /** What services provided, by service key. Never credentials or runtime paths. */
  provenance: Readonly<Record<string, unknown>>;
  /** Suite and service files. */
  files: readonly EvidenceFile[];
  tests: readonly TestEntry[];
}>;

/** A run with its test records loaded: what the host returns and what `readRunRecord` reconstructs. */
export type SuiteRun = Omit<RunRecord, "format" | "version" | "tests"> & Readonly<{ tests: readonly TestRecord[] }>;
