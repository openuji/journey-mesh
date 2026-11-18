import type { JourneyObserverOutput } from "@openuji/journey-core";
import type { JourneyPlan } from "@openuji/journey-execution-model";
import type { JourneyRunError, RunResult } from "@openuji/journey-runner";

import type { JourneyArtifact, JourneyArtifactStore } from "./artifacts.js";

/** One configured journey of a test, the adapter that ran it, and the key of the view the viewer draws it from. */
export type JourneySegment = Readonly<{ id: string; journeyId: string; adapter: string; view?: string }>;
/** A drawable journey document saved with the run, so reports render without the model or its source files. */
export type JourneyView = Readonly<{ format: string; document: unknown }>;
/** Presentation only: excluded phases still execute and retain their evidence. */
export type JourneyReportOptions = Readonly<{ excludedPhaseIds: readonly string[] }>;
export type SuiteReportOptions = JourneyReportOptions & Readonly<{ maxFileSizeMiB?: number }>;
/** Saved bundles contain no absolute paths: artifacts and provenance are relative, so a report can be moved or published. */
export type TestResultBundle = Readonly<{
  kind: "test"; id: string; segments: readonly JourneySegment[]; views: Readonly<Record<string, JourneyView>>;
  report?: JourneyReportOptions;
  result: RunResult; plan: JourneyPlan; outputs: readonly JourneyObserverOutput[];
  reportingErrors: readonly JourneyRunError[]; artifacts: readonly JourneyArtifact[];
}>;
export type SuiteResultBundle = Readonly<{
  kind: "suite"; target?: import("./services.js").SourceIdentity; label?: string; ok: boolean; generatedAt: string;
  storage?: import("./report-storage.js").ReportStorageOptions;
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
  storage?: import("./report-storage.js").ReportStorageOptions;
  subjects: Readonly<{ baseline: ComparisonSubject; candidate: ComparisonSubject }>;
  pairings: readonly ComparisonPairing[];
  errors: readonly JourneyRunError[]; artifacts: readonly JourneyArtifact[];
}>;
export type JourneyResultBundle = TestResultBundle | SuiteResultBundle | ComparisonResultBundle;
/** Writes provider-specific files for a finished test or suite. The host owns the report manifest. */
export type JourneyReporter = Readonly<{
  name: string;
  report(input: { readonly bundle: JourneyResultBundle; readonly artifacts: JourneyArtifactStore }): Promise<void> | void;
}>;
