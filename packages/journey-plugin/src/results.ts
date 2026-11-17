import type { JourneyObserverOutput } from "@openuji/journey-core";
import type { JourneyPlan } from "@openuji/journey-execution-model";
import type { JourneyRunError, RunResult } from "@openuji/journey-runner";

import type { JourneyArtifact, JourneyArtifactStore } from "./artifacts.js";

/** Saved bundles contain no absolute paths: artifacts and provenance are relative, so a report can be moved or published. */
export type TestResultBundle = Readonly<{
  kind: "test"; id: string;
  result: RunResult; plan: JourneyPlan; outputs: readonly JourneyObserverOutput[];
  reportingErrors: readonly JourneyRunError[]; artifacts: readonly JourneyArtifact[];
}>;
export type SuiteResultBundle = Readonly<{
  kind: "suite"; label?: string; ok: boolean; generatedAt: string;
  tests: readonly TestResultBundle[]; errors: readonly JourneyRunError[];
  provenance?: Readonly<Record<string, unknown>>;
  artifacts: readonly JourneyArtifact[];
}>;
export type ComparisonPairing = Readonly<{
  id: string;
  baseline: Readonly<{ test: string; profile: string }>;
  candidate: Readonly<{ test: string; profile: string }>;
}>;
/** One side of a comparison: a saved suite bundle, or the errors that prevented reading it. */
export type ComparisonSubject = Readonly<{
  source: string; label?: string; bundle: SuiteResultBundle | null; errors: readonly JourneyRunError[];
}>;
export type ComparisonResultBundle = Readonly<{
  kind: "comparison"; title: string; ok: boolean; generatedAt: string;
  subjects: Readonly<{ baseline: ComparisonSubject; candidate: ComparisonSubject }>;
  pairings: readonly ComparisonPairing[];
  errors: readonly JourneyRunError[]; artifacts: readonly JourneyArtifact[];
}>;
export type JourneyResultBundle = TestResultBundle | SuiteResultBundle | ComparisonResultBundle;
/** Writes provider-specific files for a finished test or suite. Reporters never write `bundle.json`. */
export type JourneyReporter = Readonly<{
  name: string;
  report(input: { readonly bundle: JourneyResultBundle; readonly artifacts: JourneyArtifactStore }): Promise<void> | void;
}>;
