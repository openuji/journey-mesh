/**
 * What the findings observer records in a run: the failed operations, with facts only, never prose or
 * verdicts. Reporting reads this entry alone; it loads no browser runtime.
 */
import type { JourneyInputAction, JourneyObserverOutput } from "@openuji/journey-core";

export const findingsObserverKind = "findings";
export const findingsEvidenceFormat = "journey-mesh/findings-evidence";

/** CSS pixels in viewport coordinates. */
export type FindingBox = Readonly<{ x: number; y: number; width: number; height: number }>;

/** One element as the user meets it, read without scrolling, focusing or hovering. */
export type ElementFact = Readonly<{
  /** Elements the reference matched; the other fields describe it only when this is 1. */
  matches: number;
  visible: boolean;
  /** Role and accessible name as Playwright's role engine computes them (`ariaSnapshot`). */
  role?: string;
  name?: string;
  /** Snapshot attributes such as `disabled`, `expanded`, `selected`, `checked`. */
  states?: readonly string[];
  box?: FindingBox;
  /** The whole box lies inside the viewport. */
  inViewport: boolean;
  /** `outerHTML`, cut at 600 characters. */
  markup?: string;
}>;

export type FindingScreenshot = Readonly<{
  href: string;
  viewport: Readonly<{ width: number; height: number }>;
  /** Device pixels per CSS pixel. */
  scale: number;
}>;

export type CaptureError = Readonly<{ name: string; message: string }>;

/** The page when the operation failed. */
export type FindingSnapshot = Readonly<{
  screenshot?: FindingScreenshot;
  /** Path and hash of an http(s) page; no origin, no query. */
  path?: string;
  /** Browser name and version, e.g. `chromium 141.0.7390.37`. */
  browser?: string;
  /** The focused object (`aria-activedescendant` followed), or null when the document has focus. */
  focus: ElementFact | null;
  /** Where focus belongs, for a failed focus check that names an object. */
  expectedFocus?: ElementFact;
  /** Whether the focused object is the expected focus element. */
  focusIsExpected?: boolean;
  /** The capture failed; the fields above may be partial. */
  error?: CaptureError;
}>;

/** What the failed check was waiting for. */
export type ExpectedTarget = Readonly<{
  /**
   * `state`: a state's target. `activation`: a transition's target. The rest are where the user is,
   * decided by the move kinds' type (`stepPosition`), never by the modality or an IRI: `focus` where a
   * FocusMoveKind move, an activation at focus, the start of a materialization or text entry expected
   * focus; `pointer` where a pointAt move, an activation at the pointer or a start expected the pointer;
   * `shortcut` the object a ShortcutStep acts on.
   */
  kind: "state" | "activation" | "focus" | "pointer" | "shortcut";
  /** The check was where the materialization starts (`materializationStartLocatorRef`). */
  start?: true;
  role?: string;
  name?: string;
  /** The context the locator is scoped to, e.g. a dialog. */
  context?: Readonly<{ role?: string; name?: string }>;
  expectedCount: number;
  /** How many elements matched when the failure was observed; absent for a focus move without a locator. */
  count?: number;
}>;

/** The last State this execution confirmed before the failure, as the findings observer saw it. */
export type ConfirmedState = Readonly<{ operationId: string; screenshot: FindingScreenshot }>;

export type FailureCapture = Readonly<{
  runId: string;
  executionId: string;
  profileId: string;
  operationId: string;
  error: CaptureError;
  stepId?: string;
  gesture?: string;
  expected?: ExpectedTarget;
  /** The expected element, when exactly one matched (for example, present but hidden). */
  target?: ElementFact;
  /** Elements with the expected role inside the expected context, most similar name first. */
  /** `sameIgnoringWhitespace`: the name differs from the expected one, but only in spacing. */
  candidates: readonly (ElementFact & Readonly<{ sameIgnoringWhitespace: boolean }>)[];
  snapshot: FindingSnapshot;
  before?: ConfirmedState;
}>;

export type FindingsEvidence = Readonly<{
  format: typeof findingsEvidenceFormat;
  version: 1;
  failures: readonly FailureCapture[];
  actions: readonly JourneyInputAction[];
  /** Captures that could not be attempted at all; they never affect a verdict. */
  problems: readonly CaptureError[];
}>;

/**
 * How names compare: trimmed, with runs of whitespace collapsed. A space the name computation inserts
 * between two words still counts, so "Table o r view" is not "Table or view".
 */
export const normalizedName = (name: string): string => name.trim().replace(/\s+/g, " ");

export type FindingsObserverOutput = JourneyObserverOutput & Readonly<{ kind: typeof findingsObserverKind; evidence: FindingsEvidence }>;

export function isFindingsOutput(output: JourneyObserverOutput): output is FindingsObserverOutput {
  const evidence = output.evidence as Partial<FindingsEvidence> | undefined;
  return output.kind === findingsObserverKind && evidence?.format === findingsEvidenceFormat && evidence.version === 1;
}
