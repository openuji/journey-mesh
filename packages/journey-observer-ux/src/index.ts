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
export type UXProbe = Readonly<{ id: string; label: string; at: string; target: string }>;
export type UXObservation = Readonly<{
  runId: string; executionId: string; profileId: string; operationId: string;
  probeId: string; targetOperationId: string; visible: boolean; inViewport: boolean;
}>;
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
  }
}

/** Calculation belongs to the observer; reports and comparisons consume this immutable output. */
export function deriveUXOutput(input: UXConfiguration & Readonly<{
  result: RunResult; actions: readonly JourneyInputAction[]; observations: readonly UXObservation[];
}>): JourneyObserverOutput {
  validateUXConfiguration(input);
  const measurements: JourneyMeasurement[] = [];
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
    }
  }
  return immutableSnapshot({ id: input.id, kind: "ux", measurements, evidence: { actions: input.actions.filter((action) => action.runId === input.result.runId), observations: input.observations.filter((observation) => observation.runId === input.result.runId) }, errors: [] });
}
