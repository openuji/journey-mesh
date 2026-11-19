/**
 * The report model: plain JSON derived from a run record, shaped for templates and frontends.
 * Every join a report needs (plan × execution × observer interpretation × evidence files) is done here,
 * so consumers only read and render. All `href`s are relative to the run directory the model belongs to.
 */
import type { JourneyMeasurement } from "@openuji/journey-core";
import type { ArtifactScope, SourceIdentity } from "@openuji/journey-plugin";

export const reportModelFormat = "journey-mesh/report-model";
export const testModelFormat = "journey-mesh/report-model/test";

/** Profile level: an execution outcome, or why the profile did not execute. */
export type Outcome = "passed" | "failed" | "not-executed" | "not-applicable";
/** Step and journey-map state level. */
export type StepOutcome = "passed" | "failed" | "not-executed";

export type ModelError = Readonly<{ name: string; message: string }>;
/** A reporting problem (an interpreter failed, a journey map is broken). Never part of the test verdict. */
export type ReportError = ModelError & Readonly<{ test?: string }>;

/** An evidence file of the run. Interpret `format` to render it; otherwise link `href`. */
export type FileRef = Readonly<{ href: string; name: string; contentType: string; format?: string; scope?: ArtifactScope }>;

/**
 * Compact per-step metrics from an observer interpreter, e.g. for journey-map node footers.
 * Open by design; documented kinds:
 * - `axe`: `{ pageState?: Counts; matchedSurface?: Counts }` with `Counts = { violations, incomplete, passes, inapplicable }`
 * - `native`: `{ findings: number; passes: number }`
 * - `skipped`: `{ reason?: string }`
 */
export type NodeMetrics = Readonly<{ kind: string; [key: string]: unknown }>;

/** A JSON document an interpreter derived from observer evidence (e.g. an axe path report). */
export type DataRef = Readonly<{ href: string; name: string; format: string; label?: string; observer: string }>;

export type ProfileSummary = Readonly<{ id: string; outcome: Outcome; steps: number; failedSteps: number }>;
export type TestSummary = Readonly<{
  id: string;
  ok: boolean;
  /** The test model, relative to the run directory. */
  href: string;
  metricKinds: readonly string[];
  profiles: readonly ProfileSummary[];
}>;

export type MeasurementDifference = Readonly<{
  pairing: string; observer: string; metric: string; label: string; unit: string;
  status: "available" | "missing" | "partial" | "incompatible";
  baseline: JourneyMeasurement | null; candidate: JourneyMeasurement | null;
  delta: number | null; changed: boolean | null; reason?: string;
}>;
export type ComparisonPairing = Readonly<{
  id: string;
  baseline: Readonly<{ test: string; profile: string }>;
  candidate: Readonly<{ test: string; profile: string }>;
}>;
export type ComparisonSubject = Readonly<{
  label?: string;
  ok: boolean;
  errors: readonly ModelError[];
  /** The subject's run directory below the comparison directory (`subjects/<side>`), or null if it could not be read. */
  directory: string | null;
}>;
export type ComparisonModel = Readonly<{
  title: string;
  pairings: readonly ComparisonPairing[];
  differences: readonly MeasurementDifference[];
  subjects: Readonly<{ baseline: ComparisonSubject; candidate: ComparisonSubject }>;
}>;

/** `report/report.json`. */
export type ReportModel = Readonly<{
  format: typeof reportModelFormat;
  version: 1;
  kind: "suite" | "comparison";
  generatedAt: string;
  label?: string;
  target?: SourceIdentity;
  /** The run verdict, copied from the run record. Report errors never change it. */
  ok: boolean;
  startedAt?: string;
  finishedAt?: string;
  provenance?: Readonly<Record<string, unknown>>;
  /** Suite-level execution errors from the run record. */
  runErrors: readonly ModelError[];
  /** Problems deriving this report. */
  errors: readonly ReportError[];
  /** Suite and service evidence files. */
  files: readonly FileRef[];
  /** Empty for a comparison. */
  tests: readonly TestSummary[];
  comparison?: ComparisonModel;
}>;

export type ViewRef = Readonly<{ href: string; format: string }>;
export type MapState = Readonly<{ outcome: StepOutcome; error?: string; metrics?: NodeMetrics; screenshot?: string }>;
export type JourneyMapModel = Readonly<{
  /** Key in `TestModel.views`. */
  view: string;
  segments: readonly string[];
  rootStartIds: readonly string[];
  /** Touchpoint ID → adapters that executed operations at it. */
  touchpoints: Readonly<Record<string, readonly string[]>>;
}>;

export type StepModel = Readonly<{
  id: string;
  sequence: number;
  kind: string;
  segment?: string;
  touchpointId: string;
  label: string;
  phaseId?: string;
  /** In a phase excluded from this report by configuration; it still executed. */
  excluded: boolean;
  stateId?: string;
  from?: string;
  to?: string;
  outcome: StepOutcome;
  error?: string;
  metrics?: NodeMetrics;
  screenshots: readonly FileRef[];
  files: readonly FileRef[];
}>;

export type ProfileModel = Readonly<{
  id: string;
  executionId?: string;
  outcome: Outcome;
  error?: ModelError;
  /** Why the profile was not applicable. */
  reason?: string;
  steps: readonly StepModel[];
  /** View key → model state ID → overlay for the journey map. */
  mapStates: Readonly<Record<string, Readonly<Record<string, MapState>>>>;
  measurements: readonly JourneyMeasurement[];
  /** Files of this execution that belong to no single step. */
  files: readonly FileRef[];
}>;

/** `report/tests/<encoded-test-id>.json`. */
export type TestModel = Readonly<{
  format: typeof testModelFormat;
  version: 1;
  id: string;
  ok: boolean;
  /** What made the test fail: execution errors and observer findings. */
  failures: readonly (ModelError & Readonly<{ source: "execution" | "observer" }>)[];
  excludedPhaseIds: readonly string[];
  /** View key → model snapshot (`{ format, document }` JSON). `format` is e.g. `journey-map`. */
  views: Readonly<Record<string, ViewRef>>;
  journeys: readonly Readonly<{ segmentId: string; journeyId: string; adapter: string; view?: string }>[];
  maps: readonly JourneyMapModel[];
  mapErrors: readonly string[];
  /** Interpreter outputs. */
  data: readonly DataRef[];
  /** Test-wide evidence files (no execution scope). */
  files: readonly FileRef[];
  profiles: readonly ProfileModel[];
}>;

/** Any JSON file of the report model; the root of `schema/report-model.schema.json`. */
export type ReportModelDocument = ReportModel | TestModel;
