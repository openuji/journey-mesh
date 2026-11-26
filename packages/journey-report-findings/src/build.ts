/**
 * Turns the findings observer's facts into findings: each failed check, grouped across profiles.
 * Failures in excluded phases (setup) are left out. Reads the findings observer's evidence only.
 */
import { immutableSnapshot, type JourneyInputAction } from "@openuji/journey-core";
import type { JourneyPlanOperation, ResolvedMaterializationStep } from "@openuji/journey-execution-model";
import {
  normalizedName,
  type ElementFact,
  type FailureCapture,
  type FindingSnapshot,
  type FindingsEvidence
} from "@openuji/journey-observer-findings/evidence";
import type { TestRecord } from "@openuji/journey-run-record";
import {
  findingsReportFormat,
  type FailureClass,
  type Finding,
  type FindingFrame,
  type FindingMark,
  type FindingMarkup,
  type FindingsReport,
  type ReproduceStep
} from "./types.js";

export type BuildFindingsInput = Readonly<{
  observerId: string;
  test: TestRecord;
  evidence: FindingsEvidence;
  excludedPhaseIds: readonly string[];
}>;

type Execution = Readonly<{ executionId: string; profileId: string }>;

export function buildFindingsReport(input: BuildFindingsInput): FindingsReport {
  const { test, evidence, observerId, excludedPhaseIds } = input;
  const operations = [...test.plan.operations].sort((left, right) => left.sequence - right.sequence);
  const operation = (id: string) => operations.find((item) => item.id === id);
  const executions: Execution[] = test.result.executions.map(({ executionId, profileId }) => ({ executionId, profileId }));
  const label = (id: string) => labelOf(operation(id), id);

  /** The keys up to `upTo`; in `upTo` itself, only those up to the step that failed. */
  function reproduce(executionId: string, upTo: string, failedStepId: string | undefined): ReproduceStep[] {
    const last = operation(upTo)?.sequence ?? Number.POSITIVE_INFINITY;
    const latest = new Map<string, JourneyInputAction>();
    for (const action of evidence.actions) if (action.executionId === executionId) latest.set(action.id, action);
    const performed = [...latest.values()].sort((left, right) => actionNumber(left) - actionNumber(right));
    // What a fallback materialization pressed after the failure is the way around it, not the way to it.
    const failed = performed.find((action) => action.operationId === upTo && action.status === "failed" && action.stepId === failedStepId);
    const pressed = failed ? performed.filter((action) => action.operationId !== upTo || actionNumber(action) <= actionNumber(failed)) : performed;
    const transitions = operations.filter((item) => item.kind === "transition" && item.sequence <= last);
    const hidden = transitions.filter((item) => excludedPhaseIds.includes(phaseOf(item) ?? ""));
    const steps: ReproduceStep[] = hidden.length ? [{ label: `Complete the setup (${hidden.length} ${hidden.length === 1 ? "step" : "steps"}, left out of this report)` }] : [];
    for (const item of transitions) {
      if (hidden.includes(item)) continue;
      const keys = collapseKeys(pressed.filter((action) => action.operationId === item.id && action.status !== "attempted").map((action) => action.gesture).filter((gesture): gesture is string => !!gesture));
      steps.push({ label: labelOf(item, item.id), ...(keys ? { keys } : {}) });
    }
    return steps;
  }

  const excluded = (operationId: string) => {
    const item = operation(operationId);
    return !!item && excludedPhaseIds.includes(phaseOf(item) ?? "");
  };

  function failureFindings(): Finding[] {
    const groups = new Map<string, { failureClass: FailureClass; items: { execution: Execution; failure: FailureCapture }[] }>();
    for (const execution of executions) {
      for (const failure of evidence.failures.filter((item) => item.executionId === execution.executionId && !excluded(item.operationId))) {
        const failureClass = classify(failure);
        const key = JSON.stringify([failure.operationId, failureClass, failure.expected?.kind, failure.expected?.role, failure.expected?.name, failure.expected?.context]);
        const group = groups.get(key) ?? { failureClass, items: [] };
        group.items.push({ execution, failure });
        groups.set(key, group);
      }
    }
    const used = new Set<string>();
    return [...groups.values()].map(({ failureClass, items }) => {
      const { execution, failure } = items[0]!;
      const base = `${test.id}--${ujgSegment(operation(failure.operationId), failure.operationId)}`;
      const id = !used.has(base) ? base : !used.has(`${base}--${failureClass}`) ? `${base}--${failureClass}` : `${base}--${operation(failure.operationId)?.sequence ?? used.size}`;
      used.add(id);
      const text = failureText(failureClass, failure, label(failure.operationId), stepOf(operation(failure.operationId), failure.stepId));
      const frames: FindingFrame[] = [];
      const shot = failure.snapshot.screenshot;
      if (failure.before && shot) {
        const before = failure.before.screenshot;
        frames.push({ key: "before", label: `Last confirmed: "${label(failure.before.operationId)}"`, screenshot: before.href, viewport: before.viewport, scale: before.scale, marks: [] });
      }
      if (shot) {
        const { marks, banners } = failureMarks(failureClass, failure);
        frames.push(frame("failure", `At failure: "${label(failure.operationId)}"`, failure.snapshot, marks, banners));
      }
      return immutableSnapshot({
        id, test: test.id, failureClass, ...text,
        operationId: failure.operationId,
        // An operation can fail the same way twice in one execution: its canonical path, then the fallback.
        executions: [...new Map(items.map((item) => [item.execution.executionId, item.execution])).values()],
        frames,
        reproduce: reproduce(execution.executionId, failure.operationId, failure.stepId),
        ...(failure.snapshot.path ? { path: failure.snapshot.path } : {}),
        ...(failure.snapshot.browser ? { browser: failure.snapshot.browser } : {}),
        markup: markupOf([failure.target, ...failure.candidates, failure.snapshot.focus]),
        error: failure.error.message
      });
    });
  }

  const findings = failureFindings();
  findings.sort((left, right) => (operation(left.operationId)?.sequence ?? 0) - (operation(right.operationId)?.sequence ?? 0));
  return immutableSnapshot({ format: findingsReportFormat, version: 1, observerId, test: test.id, findings });
}

/** From the captured facts, never the error text. A focus check is one only when the step's move kind made it one. */
function classify(failure: FailureCapture): FailureClass {
  const expected = failure.expected;
  if (!expected) return "other";
  if (expected.kind === "focus") return "focus-mismatch";
  if (expected.expectedCount === 0 && (expected.count ?? 0) > 0) return "target-present";
  if (expected.count === 0) return "target-missing";
  if (expected.count !== undefined && expected.count > expected.expectedCount) return "target-ambiguous";
  return "other";
}

/** The declared step that failed, to say whether focus was to move or to be at the object. */
function stepOf(operation: JourneyPlanOperation | undefined, stepId: string | undefined): ResolvedMaterializationStep | undefined {
  if (operation?.kind !== "transition" || !stepId) return undefined;
  return operation.materializations?.flatMap((materialization) => materialization.steps).find((step) => step.id === stepId);
}

function failureText(failureClass: FailureClass, failure: FailureCapture, operationLabel: string, step: ResolvedMaterializationStep | undefined): Pick<Finding, "title" | "expected" | "observed"> {
  const expected = failure.expected;
  const target = expected ? named(expected.role, expected.name) : "the target";
  const within = expected?.context ? ` in the ${named(expected.context.role, expected.context.name)}` : "";
  const found = failure.candidates.length
    ? ` Found instead: ${failure.candidates.map((candidate) => describe(candidate)).join(", ")}.${failure.candidates.filter((candidate) => candidate.sameIgnoringWhitespace).map((candidate) => ` ${capitalize(describe(candidate))} differs from the expected name only in spacing.`).join("")}`
    : "";
  const focusNow = failure.snapshot.focus ? `Focus is on ${describe(failure.snapshot.focus)}.` : "No element has focus: the document has it.";
  const nearMiss = expected?.name ? failure.candidates.find((candidate) => isNearMiss(candidate, expected.name!)) : undefined;
  switch (failureClass) {
    case "target-missing":
      return { title: nearMiss ? `${capitalize(target)} is named "${nearMiss.name}"${within}` : `${capitalize(target)} not found${within}`, expected: `A ${target}${within} ("${operationLabel}").`, observed: `No ${expected?.role ?? "element"} with that name is there.${found}` };
    case "target-ambiguous":
      return { title: `${expected!.count} elements match ${target}${within}`, expected: `Exactly ${expected!.expectedCount} ${target}${within} ("${operationLabel}").`, observed: `${expected!.count} elements match.${found}` };
    case "target-present":
      return { title: `${capitalize(target)} is still shown${within}`, expected: `No ${target}${within} ("${operationLabel}").`, observed: expected!.count === 1 ? "It is still there." : `${expected!.count} of them are still there.` };
    case "focus-mismatch": {
      const pressed = failure.gesture ? ` with ${failure.gesture}` : "";
      if (expected?.start) {
        return { title: `Focus is not on ${target} where "${operationLabel}" starts`, expected: `"${operationLabel}" starts with focus on ${target}.`, observed: focusNow };
      }
      if (step?.kind === "move" && !step.locator) {
        return { title: `Focus does not move in "${operationLabel}"`, expected: `Focus moves${pressed}.`, observed: failure.snapshot.focus ? `Focus stays on ${describe(failure.snapshot.focus)}.` : focusNow };
      }
      if (step?.kind === "activation") {
        return { title: `Focus is not on ${target} in "${operationLabel}"`, expected: `Focus is on ${target}, so it can be activated.`, observed: focusNow };
      }
      return { title: `Focus does not reach ${target} in "${operationLabel}"`, expected: `Focus moves to ${target}${pressed}.`, observed: focusNow };
    }
    default:
      return { title: `"${operationLabel}" failed`, expected: `"${operationLabel}" completes.`, observed: failure.error.message };
  }
}

function failureMarks(failureClass: FailureClass, failure: FailureCapture): { marks: FindingMark[]; banners: string[] } {
  const marks: FindingMark[] = [];
  const banners: string[] = [];
  if (failureClass === "focus-mismatch") {
    const focus = failure.snapshot.focus;
    if (!focus) banners.push("No element has focus");
    else if (focus.box) marks.push({ tone: "problem", box: focus.box, label: `focus: ${describe(focus)}` });
    if (failure.target?.box) marks.push({ tone: "expected", box: failure.target.box, label: `expected focus: ${describe(failure.target)}` });
    return { marks, banners };
  }
  if (failureClass === "target-present") {
    // What is still there: the objects with the name the State expected to be gone.
    const name = failure.expected?.name;
    const present = failure.candidates.filter((candidate) => name === undefined || (candidate.name !== undefined && normalizedName(candidate.name) === normalizedName(name)));
    for (const candidate of present) if (candidate.box) marks.push({ tone: "problem", box: candidate.box, label: describe(candidate) });
    if (!marks.length && failure.target?.box) marks.push({ tone: "problem", box: failure.target.box, label: describe(failure.target) });
    if (!marks.length && failure.expected) banners.push(`${capitalize(named(failure.expected.role, failure.expected.name))} is still there`);
    return { marks, banners };
  }
  if (failureClass === "target-missing" || failureClass === "target-ambiguous") {
    // The closest element is the problem; the others are what else is there.
    const expectedName = failure.expected?.name ?? "";
    const flagged = failure.candidates.some((candidate) => isNearMiss(candidate, expectedName));
    failure.candidates.forEach((candidate, index) => {
      if (!candidate.box) return;
      const problem = failureClass === "target-ambiguous" || (flagged ? isNearMiss(candidate, expectedName) : index === 0);
      marks.push({ tone: problem ? "problem" : "context", box: candidate.box, label: describe(candidate) });
    });
    if (!marks.length && failure.expected) banners.push(`No ${named(failure.expected.role, failure.expected.name)}`);
    return { marks, banners };
  }
  if (failure.target?.box) marks.push({ tone: "problem", box: failure.target.box, label: describe(failure.target) });
  banners.push(failure.error.message.split("\n")[0]!.slice(0, 120));
  return { marks, banners };
}

/** A candidate whose name is the expected one with something added, or with different spacing. */
function isNearMiss(candidate: FailureCapture["candidates"][number], expectedName: string): boolean {
  if (!expectedName || candidate.name === undefined) return false;
  return candidate.sameIgnoringWhitespace || normalizedName(candidate.name).toLowerCase().includes(normalizedName(expectedName).toLowerCase());
}

function frame(key: FindingFrame["key"], label: string, snapshot: FindingSnapshot, marks: FindingMark[], banners: string[] = []): FindingFrame {
  const shot = snapshot.screenshot!;
  return { key, label, screenshot: shot.href, viewport: shot.viewport, scale: shot.scale, ...(banners.length ? { banner: banners.join(" · ") } : {}), marks };
}

function markupOf(facts: readonly (ElementFact | null | undefined)[]): FindingMarkup[] {
  const seen = new Set<string>();
  const result: FindingMarkup[] = [];
  for (const fact of facts) {
    if (!fact?.markup || seen.has(fact.markup)) continue;
    seen.add(fact.markup);
    result.push({ label: describe(fact), html: fact.markup });
  }
  return result.slice(0, 6);
}

/** `button "Save"`, `button`, or `element`. */
export function describe(fact: Pick<ElementFact, "role" | "name">): string {
  return named(fact.role, fact.name);
}

function named(role: string | undefined, name: string | undefined): string {
  return name !== undefined ? `${role ?? "element"} "${name}"` : role ?? "element";
}

/** Consecutive repeats collapse: `Tab, Tab, Tab, Space` becomes `Tab ×3, Space`; a pointer move then press is `click`. */
export function collapseKeys(gestures: readonly string[]): string {
  const runs: { key: string; count: number }[] = [];
  const inputs: string[] = [];
  // Pointing at a control and pressing it is a click.
  for (const gesture of gestures) {
    if (gesture === "pointer-press" && inputs.at(-1) === "pointer-move") inputs[inputs.length - 1] = "click";
    else inputs.push(gesture);
  }
  for (const gesture of inputs) {
    const last = runs.at(-1);
    if (last?.key === gesture) last.count++;
    else runs.push({ key: gesture, count: 1 });
  }
  return runs.map((run) => run.count > 1 ? `${run.key} ×${run.count}` : run.key).join(", ");
}

function actionNumber(action: JourneyInputAction): number {
  return Number(action.id.split("/").at(-1)) || 0;
}

function labelOf(operation: JourneyPlanOperation | undefined, fallback: string): string {
  if (operation?.kind === "state") return operation.state.label ?? operation.state.id;
  if (operation?.kind === "transition") return operation.transition.label ?? operation.transition.id;
  return fallback;
}

function phaseOf(operation: JourneyPlanOperation): string | undefined {
  const phaseId = operation.source?.references?.phaseId;
  return typeof phaseId === "string" ? phaseId : undefined;
}

/** The last segment of the model's own operation id, which stays the same across runs. */
function ujgSegment(operation: JourneyPlanOperation | undefined, fallback: string): string {
  const original = operation?.source?.references?.originalOperationId;
  const id = typeof original === "string" ? original : fallback;
  return id.split(/[:/]/).filter(Boolean).at(-1) ?? id;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
