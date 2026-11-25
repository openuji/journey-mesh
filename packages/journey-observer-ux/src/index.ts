import { immutableSnapshot, type JourneyInputAction, type JourneyMeasurement, type JourneyObserverOutput } from "@openuji/journey-core";
import type { JourneyPlanOperation } from "@openuji/journey-execution-model";
import type { RunResult } from "@openuji/journey-runner";

export { immutableSnapshot } from "@openuji/journey-core";
export type { Immutable } from "@openuji/journey-core";

/** All references are compiled operation identities, resolved before execution. */
export type UXCounter = Readonly<{
  id: string; label: string; from: string; until: string;
  operations?: readonly string[];
  status?: "attempted" | "completed" | "failed";
}>;
export type UXCheckpoint = Readonly<{ id: string; label: string; operation: string }>;
/**
 * What a probe requires, checked after the observation: `visible` and `inViewport` (fully contained in
 * the viewport) describe the probe's target; `scrolled` requires the page to be scrolled vertically.
 */
export const uxExpectations = ["visible", "inViewport", "scrolled"] as const;
export type UXExpectation = (typeof uxExpectations)[number];
/** Without `expect` a probe is informational; with it, an unmet expectation is an observer error and fails the test. */
export type UXProbe = Readonly<{ id: string; label: string; at: string; target: string; expect?: readonly UXExpectation[]; screenshot?: boolean }>;
/** CSS pixels in viewport coordinates, read without scrolling, focusing or hovering. */
export type UXGeometry = Readonly<{
  /** Elements matching the target; only exactly one can be measured. */
  matches: number;
  rect: Readonly<{ x: number; y: number; width: number; height: number }> | null;
  viewport: Readonly<{ width: number; height: number }> | null;
  scroll: Readonly<{ x: number; y: number }>;
  /** False when the readings kept changing until the bounded stabilization gave up. */
  stable: boolean;
}>;
export type UXObservation = Readonly<{
  runId: string; executionId: string; profileId: string; operationId: string;
  probeId: string; targetOperationId: string; visible: boolean; inViewport: boolean;
  geometry?: UXGeometry;
  /** Hrefs of the geometry record and the viewport screenshot written for this probe. */
  files?: readonly string[];
}>;
/** The format of a probe's geometry evidence file. */
export const uxGeometryFormat = "journey-mesh/ux-geometry";
export type UXConfiguration = Readonly<{
  id: string; operations: readonly JourneyPlanOperation[];
  counters: readonly UXCounter[]; checkpoints: readonly UXCheckpoint[]; probes: readonly UXProbe[];
}>;

export function validateUXConfiguration(config: UXConfiguration): void {
  const ids = new Set<string>();
  const operation = (id: string) => {
    const matches = config.operations.filter((op) => op.id === id);
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous compiled operation: ${id}`);
    return matches[0];
  };
  for (const metric of [...config.counters, ...config.checkpoints, ...config.probes]) {
    if (ids.has(metric.id)) throw new Error(`Duplicate UX measurement ID: ${metric.id}`);
    ids.add(metric.id);
  }
  for (const counter of config.counters) {
    if (config.operations.indexOf(operation(counter.from)) > config.operations.indexOf(operation(counter.until))) throw new Error(`Counter ${counter.id} has reversed boundaries`);
    counter.operations?.forEach(operation);
  }
  config.checkpoints.forEach((checkpoint) => operation(checkpoint.operation));
  for (const probe of config.probes) {
    if (operation(probe.at).kind !== "state" || operation(probe.target).kind === "control-flow") throw new Error(`Probe ${probe.id} requires a state and an observable target`);
    for (const expectation of probe.expect ?? []) {
      if (!uxExpectations.includes(expectation)) throw new Error(`Probe ${probe.id} has unknown expectation ${expectation}; use ${uxExpectations.join(", ")}`);
    }
  }
}

/** Why an observation does not meet an expectation, or undefined when it does. */
export function unmetExpectation(expectation: UXExpectation, fact: UXObservation): string | undefined {
  const geometry = fact.geometry;
  if (!geometry) return "no geometry was observed";
  if (!geometry.stable) return "the target's geometry did not stabilize";
  if (expectation === "scrolled") return geometry.scroll.y > 0 ? undefined : `the page is not scrolled (scrollY ${geometry.scroll.y})`;
  if (geometry.matches !== 1) return `the target matched ${geometry.matches} elements, not exactly one`;
  if (!fact.visible || !geometry.rect) return "the target is not visible";
  if (expectation === "visible") return undefined;
  const { rect, viewport } = geometry;
  if (!viewport) return "the viewport size is unknown";
  return fact.inViewport ? undefined
    : `the target (x ${rect.x}, y ${rect.y}, ${rect.width}×${rect.height}) is not contained in the ${viewport.width}×${viewport.height} viewport`;
}

/** Calculation belongs to the observer; reports and comparisons consume this immutable output. */
export function deriveUXOutput(input: UXConfiguration & Readonly<{
  result: RunResult; actions: readonly JourneyInputAction[]; observations: readonly UXObservation[];
}>): JourneyObserverOutput {
  validateUXConfiguration(input);
  const measurements: JourneyMeasurement[] = [];
  const errors: { name: string; message: string }[] = [];
  for (const execution of input.result.evidence.executions) {
    const matching = (fact: { runId: string; executionId: string; profileId: string }) => fact.runId === input.result.runId && fact.executionId === execution.executionId && fact.profileId === execution.profileId;
    const actions = [...new Map(input.actions.filter(matching).map((action) => [action.id, action])).values()];
    const scope = (operationIds: readonly string[]) => ({ runId: input.result.runId, executionId: execution.executionId, profileId: execution.profileId, operationIds });
    const passed = (id: string) => execution.operations.some((op) => op.operationId === id && op.outcome.kind === "passed");
    for (const counter of input.counters) {
      const from = input.operations.findIndex((op) => op.id === counter.from);
      const until = input.operations.findIndex((op) => op.id === counter.until);
      const operationIds = input.operations.slice(from, until + 1).map((op) => op.id);
      const observed = actions.filter((action) => operationIds.includes(action.operationId) && (!counter.operations || counter.operations.includes(action.operationId)));
      const started = passed(counter.from) || observed.length > 0;
      const complete = passed(counter.from) && passed(counter.until);
      const status = counter.status ?? "attempted";
      measurements.push({
        id: counter.id, label: counter.label, method: `adapter-command-${status}`, unit: "adapter-command", aggregation: "count", scope: scope(operationIds),
        status: complete ? "available" : started ? "partial" : "unavailable",
        value: started ? observed.filter((action) => status === "attempted" || action.status === status).length : null,
        ...(!complete ? { reason: started ? "The interval did not complete; the value counts observed actions only." : "The interval was not reached." } : {})
      });
    }
    for (const checkpoint of input.checkpoints) {
      const outcome = execution.operations.find((op) => op.operationId === checkpoint.operation)?.outcome;
      measurements.push({ id: checkpoint.id, label: checkpoint.label, method: "functional-operation-outcome", unit: "boolean", aggregation: "identity", scope: scope([checkpoint.operation]), status: outcome ? "available" : "unavailable", value: outcome ? outcome.kind === "passed" : null, ...(!outcome ? { reason: "Checkpoint was not executed." } : {}) });
    }
    for (const probe of input.probes) {
      const fact = input.observations.filter(matching).find((item) => item.probeId === probe.id && item.operationId === probe.at && item.targetOperationId === probe.target);
      for (const property of ["visible", "inViewport"] as const) measurements.push({ id: `${probe.id}/${property}`, label: `${probe.label} (${property === "visible" ? "visible" : "in viewport"})`, method: `passive-target-${property}`, unit: "boolean", aggregation: "identity", scope: scope([probe.at, probe.target]), status: fact ? "available" : "unavailable", value: fact ? fact[property] : null, ...(!fact ? { reason: "Probe was not observed." } : {}) });
      const scrollY = fact?.geometry?.scroll.y;
      measurements.push({ id: `${probe.id}/scrollY`, label: `${probe.label} (page scroll)`, method: "passive-page-scroll-y", unit: "px", aggregation: "identity", scope: scope([probe.at]), status: scrollY === undefined ? "unavailable" : "available", value: scrollY ?? null, ...(scrollY === undefined ? { reason: "Probe was not observed." } : {}) });
      if (!probe.expect?.length) continue;
      // A probe that was due (its state passed) must have been observed; an unreached state is the execution's failure, not the probe's.
      const due = passed(probe.at);
      const where = `Probe ${probe.id} in execution ${execution.executionId}`;
      if (!fact) {
        if (due) errors.push({ name: "UXExpectationFailed", message: `${where}: expected ${probe.expect.join(", ")}, but the probe was not observed` });
        continue;
      }
      for (const expectation of probe.expect) {
        const unmet = unmetExpectation(expectation, fact);
        if (unmet) errors.push({ name: "UXExpectationFailed", message: `${where}: expected ${expectation}, but ${unmet}` });
      }
    }
  }
  return immutableSnapshot({ id: input.id, kind: "ux", measurements, evidence: { actions: input.actions.filter((action) => action.runId === input.result.runId), observations: input.observations.filter((observation) => observation.runId === input.result.runId) }, errors });
}
