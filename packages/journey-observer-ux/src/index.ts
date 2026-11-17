import type { JourneyPlanOperation } from "@openuji/journey-execution-model";
import type { RunResult } from "@openuji/journey-runner";

/** The pure entrypoint has no browser, filesystem, clock, or application dependency. */
export type MetricSelection = Readonly<{
  journeyItemId: string;
  startStateId: string;
  acceptanceTransitionId: string;
  completionStateId: string;
  navigationTransitionIds: readonly string[];
}>;

export type UXProbe = Readonly<{
  id: string;
  atStateId: string;
  targetGraphNodeId: string;
}>;
export type UXObservation = Readonly<{
  runId: string;
  executionId: string;
  profileId: string;
  operationId: string;
  graphNodeId: string;
  probeId: string;
  targetGraphNodeId: string;
  visible: boolean;
  inViewport: boolean;
}>;

export type JourneyMetrics = Readonly<{
  executionId: string;
  profileId: string;
  status: "complete" | "incomplete";
  inputActions: number | null;
  inputActionsToAcceptance: number | null;
  acceptanceVerified: boolean | null;
  navigationBeforeAcceptance: number | null;
  navigationAfterAcceptance: number | null;
  automaticReveal: boolean | null;
  observations: readonly UXObservation[];
}>;

export type Immutable<T> = T extends readonly (infer U)[]
  ? readonly Immutable<U>[]
  : T extends object
    ? { readonly [K in keyof T]: Immutable<T[K]> }
    : T;

/** Own the copy before freezing; caller-owned values are never frozen in place. */
export function immutableSnapshot<T>(value: T): Immutable<T> {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item !== null && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy as Immutable<T>;
}

export function graphNodeId(operation: JourneyPlanOperation): string {
  return operation.kind === "state"
    ? operation.state.id
    : operation.transition.id;
}

export function metricLandmarks(
  operations: readonly JourneyPlanOperation[],
  selection: MetricSelection,
) {
  const scope = operations.filter(
    (op) => op.source?.references?.journeyItemId === selection.journeyItemId,
  );
  const start = scope.findIndex(
    (op) => op.kind === "state" && op.state.id === selection.startStateId,
  );
  const acceptance = scope.findIndex(
    (op) =>
      op.kind === "transition" &&
      op.transition.id === selection.acceptanceTransitionId &&
      op.activation.requiredInputModalityProfiles.length > 0,
  );
  const completion = scope.findIndex(
    (op) => op.kind === "state" && op.state.id === selection.completionStateId,
  );
  if (start < 0 || acceptance <= start || completion <= acceptance)
    throw new Error(
      "Metric landmarks must occur in start, acceptance, completion order",
    );
  return { scope, start, acceptance, completion };
}

export function deriveJourneyMetrics(
  input: Readonly<{
    operations: readonly JourneyPlanOperation[];
    result: RunResult;
    observations: readonly UXObservation[];
    selection: MetricSelection;
  }>,
): readonly JourneyMetrics[] {
  const { operations, result, selection } = input;
  const { scope, start, acceptance, completion } = metricLandmarks(
    operations,
    selection,
  );
  return immutableSnapshot(
    result.evidence.executions.map((execution) => {
      const passed = (op: JourneyPlanOperation) =>
        execution.operations.some(
          (e) => e.operationId === op.id && e.outcome.kind === "passed",
        );
      const complete = scope.slice(start, completion + 1).every(passed);
      const accepted = scope.slice(start, acceptance + 1).every(passed);
      const acceptanceEvidence = execution.operations.find(
        (item) => item.operationId === scope[acceptance].id,
      );
      const actions = scope
        .slice(start, completion + 1)
        .filter(
          (op) =>
            op.kind === "transition" &&
            op.activation.requiredInputModalityProfiles.length > 0 &&
            passed(op),
        );
      const after = actions.filter((op) => scope.indexOf(op) > acceptance);
      return {
        executionId: execution.executionId,
        profileId: execution.profileId,
        status: complete ? ("complete" as const) : ("incomplete" as const),
        inputActions: complete ? actions.length : null,
        inputActionsToAcceptance: accepted
          ? actions.filter((op) => scope.indexOf(op) <= acceptance).length
          : null,
        acceptanceVerified: acceptanceEvidence
          ? acceptanceEvidence.outcome.kind === "passed"
          : null,
        navigationBeforeAcceptance: accepted
          ? actions.filter(
              (op) =>
                scope.indexOf(op) < acceptance &&
                selection.navigationTransitionIds.includes(graphNodeId(op)),
            ).length
          : null,
        navigationAfterAcceptance: complete
          ? after.filter((op) =>
              selection.navigationTransitionIds.includes(graphNodeId(op)),
            ).length
          : null,
        automaticReveal: complete ? after.length === 0 : null,
        observations: input.observations.filter(
          (fact) =>
            fact.runId === result.runId &&
            fact.executionId === execution.executionId &&
            fact.profileId === execution.profileId &&
            scope.some((op) => op.id === fact.operationId && passed(op)),
        ),
      };
    }),
  );
}
