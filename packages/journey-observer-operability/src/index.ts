/**
 * Records how each transition was performed: the input decision a profile made and every adapter
 * command, one per declared materialization step. It observes only; it never acts on the page.
 */
import type { PlaywrightExecutionObserver } from "@openuji/journey-adapter-playwright";
import { immutableSnapshot, type JourneyInputAction } from "@openuji/journey-core";
import type { RunResult } from "@openuji/journey-runner";
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
}>;

export const operabilityObserverName = "@openuji/journey-observer-operability";

export function operabilityObserver(options: OperabilityObserverOptions): PlaywrightExecutionObserver & {
  output(result: RunResult): OperabilityObserverOutput;
} {
  const id = options.id;
  let decisions: readonly OperabilityDecisionRecord[] = Object.freeze([]);
  let actions: readonly JourneyInputAction[] = Object.freeze([]);
  return Object.freeze({
    name: operabilityObserverName,
    onAction(action: JourneyInputAction) {
      actions = Object.freeze([...actions, immutableSnapshot(action)]);
    },
    observeOperation(observation: Parameters<NonNullable<PlaywrightExecutionObserver["observeOperation"]>>[0]) {
      if (observation.stage !== "transition-ready") return;
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
          decisions: decisions.filter((decision) => decision.runId === result.runId),
          actions: latestActions(actions.filter((action) => action.runId === result.runId))
        }
      }) as OperabilityObserverOutput;
    }
  });
}

/** An adapter reports each command as attempted, then completed or failed, under one ID; keep its final report. */
function latestActions(actions: readonly JourneyInputAction[]): readonly JourneyInputAction[] {
  const latest = new Map<string, JourneyInputAction>();
  for (const action of actions) latest.set(action.id, action);
  return [...latest.values()];
}
