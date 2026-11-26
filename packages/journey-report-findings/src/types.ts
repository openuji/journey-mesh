/**
 * `findings.json`: what a renderer needs to draw and describe each finding. A finding is an operation
 * that failed in the run; every sentence and mark is derived from captured facts.
 */
import type { FindingBox } from "@openuji/journey-observer-findings/evidence";

export const findingsReportFormat = "journey-mesh/findings";
export const findingsReportName = "findings.json";
export const findingsReportLabel = "Findings";

/** `target-present`: a State expected an object to be gone, and it is still there. */
export type FailureClass = "target-missing" | "target-ambiguous" | "target-present" | "focus-mismatch" | "other";

/** `problem`: what is wrong (solid red). `expected`: where it should be (dashed green). `context`: for orientation (grey). */
export type MarkTone = "problem" | "expected" | "context";
export type FindingMark = Readonly<{ tone: MarkTone; box: FindingBox; label: string }>;

/** `before`: the last state the execution confirmed. `failure`: the page when the check failed. */
export type FrameKey = "before" | "failure";
/** A viewport screenshot the findings observer took. */
export type FindingFrame = Readonly<{
  key: FrameKey;
  label: string;
  /** Relative to the run directory. */
  screenshot: string;
  /** CSS pixels the marks refer to. */
  viewport: Readonly<{ width: number; height: number }>;
  scale: number;
  /** A fact with no element to box, such as "No element has focus". */
  banner?: string;
  marks: readonly FindingMark[];
}>;

/** One transition of the journey up to the finding, with the keys actually pressed, e.g. `Tab ×3, Space`. */
export type ReproduceStep = Readonly<{ label: string; keys?: string }>;

/** An execution in which the operation failed the same way. */
export type FindingExecution = Readonly<{ executionId: string; profileId: string }>;

export type FindingMarkup = Readonly<{ label: string; html: string }>;

export type Finding = Readonly<{
  /** `<test>--<last segment of the UJG id>`: stable across runs. */
  id: string;
  test: string;
  /** Generated from the facts. */
  title: string;
  expected: string;
  observed: string;
  failureClass: FailureClass;
  /** The operation that failed. */
  operationId: string;
  executions: readonly FindingExecution[];
  /** From the first execution, in run order, in which the check failed; empty without a screenshot. */
  frames: readonly FindingFrame[];
  reproduce: readonly ReproduceStep[];
  /** Page path and hash, browser, and the markup of the elements involved, for the details. */
  path?: string;
  browser?: string;
  markup: readonly FindingMarkup[];
  /** The operation's error. */
  error: string;
}>;

export type FindingsReport = Readonly<{
  format: typeof findingsReportFormat;
  version: 1;
  observerId: string;
  test: string;
  findings: readonly Finding[];
}>;
