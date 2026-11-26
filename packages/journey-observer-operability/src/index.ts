/**
 * Records how each transition was performed: the input decision a profile made and every executor
 * command, one per declared materialization step. It observes only; it never acts on the page or device.
 */
import { immutableSnapshot, type JourneyInputAction } from "@openuji/journey-core";
import type { InputModalityDecision, JourneyExecutionDescriptor, RunResult } from "@openuji/journey-runner";
import {
  operabilityEvidenceFormat,
  operabilityObserverKind,
  type OperabilityDecisionRecord,
  type OperabilityObserverOutput
} from "./evidence.js";

export * from "./evidence.js";

export type OperabilityObserverOptions = Readonly<{
  /** Output ID; report data of this observer is written below it. */
  id: string;
  /** Operations owned by the executor this observer is attached to. */
  operationIds?: readonly string[];
}>;

export type OperabilityOperationObservation = Readonly<{
  stage: string;
  execution: JourneyExecutionDescriptor;
  operation: Readonly<{ id: string }>;
  decision?: InputModalityDecision;
}>;

export type OperabilityExecutionObserver = {
  readonly name: string;
  onAction?(action: JourneyInputAction): Promise<void> | void;
  observeOperation?(observation: OperabilityOperationObservation): Promise<void> | void;
};

export const operabilityObserverName = "@openuji/journey-observer-operability";

export function operabilityObserver(options: OperabilityObserverOptions): OperabilityExecutionObserver & {
  output(result: RunResult): OperabilityObserverOutput;
} {
  const id = options.id;
  const operationIds = options.operationIds ? Object.freeze([...options.operationIds]) : undefined;
  let decisions: readonly OperabilityDecisionRecord[] = Object.freeze([]);
  let actions: readonly JourneyInputAction[] = Object.freeze([]);
  return Object.freeze({
    name: operabilityObserverName,
    onAction(action: JourneyInputAction) {
      actions = Object.freeze([...actions, immutableSnapshot(action)]);
    },
    observeOperation(observation: OperabilityOperationObservation) {
      if (observation.stage !== "transition-ready" || !observation.decision) return;
      const { decision, execution, operation } = observation;
      decisions = Object.freeze([...decisions, immutableSnapshot({
        runId: execution.runId,
        executionId: execution.executionId,
        profileId: execution.profile.id,
        operationId: operation.id,
        inputModalityProfileId: decision.inputModalityProfile.id,
        modalityId: decision.modality.id,
        ...(decision.modality.label ? { modalityLabel: decision.modality.label } : {}),
        ...(decision.materialization ? { materializationId: decision.materialization.id } : {})
      })]);
    },
    output(result: RunResult): OperabilityObserverOutput {
      return immutableSnapshot({
        id, kind: operabilityObserverKind, measurements: [], errors: [],
        evidence: {
          format: operabilityEvidenceFormat, version: 1,
          ...(operationIds ? { operationIds } : {}),
          decisions: decisions.filter((decision) => decision.runId === result.runId),
          actions: latestActions(actions.filter((action) => action.runId === result.runId))
        }
      }) as OperabilityObserverOutput;
    }
  });
}

/** An executor reports each command as attempted, then completed or failed, under one ID; keep its final report. */
function latestActions(actions: readonly JourneyInputAction[]): readonly JourneyInputAction[] {
  const latest = new Map<string, JourneyInputAction>();
  for (const action of actions) latest.set(action.id, action);
  return [...latest.values()];
}
