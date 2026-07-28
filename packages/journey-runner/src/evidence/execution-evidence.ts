import type {
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyPlanOperation,
  ResolvedEffect,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";
import {
  componentEvidence,
  errorToEvidence,
  referencesForOperation,
  referencesForPlan,
  type EvidenceError,
  type ExecutionEvidenceSink,
  type JsonObject
} from "@openuji/journey-evidence";

import type {
  ExecutionResult,
  JourneyAdapter,
  JourneyExecutionContext
} from "../index.js";
import type { JourneyObserver } from "../observers/contracts.js";

export class ExecutionEvidence {
  constructor(
    private readonly context: JourneyExecutionContext,
    private readonly sink: ExecutionEvidenceSink
  ) {}

  executionStarted(): void {
    this.sink.emit({
      type: "profile.execution.started",
      ok: true,
      references: referencesForPlan(this.context.plan),
      data: { label: this.context.profile.label ?? this.context.profile.id }
    });
  }

  executionFailed(error: unknown): void {
    this.sink.emit({
      type: "profile.execution.failed",
      ok: false,
      error: toEvidenceError(error)
    });
  }

  executionCompleted(result: ExecutionResult): void {
    this.sink.emit({
      type: "profile.execution.completed",
      ok: result.ok,
      error: result.error
    });
  }

  adapterStartStarted(adapter: JourneyAdapter): void {
    this.sink.emit({
      type: "adapter.setup.started",
      ok: true,
      data: componentEvidence(adapter)
    });
  }

  adapterStartCompleted(adapter: JourneyAdapter): void {
    this.sink.emit({
      type: "adapter.setup.completed",
      ok: true,
      data: componentEvidence(adapter)
    });
  }

  adapterStartFailed(adapter: JourneyAdapter, error: unknown): void {
    this.sink.emit({
      type: "adapter.setup.failed",
      ok: false,
      data: componentEvidence(adapter),
      error: toEvidenceError(error)
    });
  }

  adapterCloseStarted(adapter: JourneyAdapter): void {
    this.sink.emit({
      type: "adapter.teardown.started",
      ok: true,
      data: componentEvidence(adapter)
    });
  }

  adapterCloseCompleted(adapter: JourneyAdapter): void {
    this.sink.emit({
      type: "adapter.teardown.completed",
      ok: true,
      data: componentEvidence(adapter)
    });
  }

  adapterCloseFailed(adapter: JourneyAdapter, error: unknown): void {
    this.sink.emit({
      type: "adapter.teardown.failed",
      ok: false,
      error: toEvidenceError(error),
      data: componentEvidence(adapter)
    });
  }

  operationStarted(operation: JourneyPlanOperation): void {
    this.operationEvent(operation, "operation.started", true);
  }

  operationCompleted(operation: JourneyPlanOperation): void {
    this.operationEvent(operation, "operation.completed", true);
  }

  openEntryStarted(operation: JourneyPlanOperation): void {
    this.operationEvent(operation, "adapter.open-entry.started", true, {
      entryBindingValue: operation.entryBinding?.value ?? null
    });
  }

  openEntryCompleted(operation: JourneyPlanOperation): void {
    this.operationEvent(operation, "adapter.open-entry.completed", true, {
      entryBindingValue: operation.entryBinding?.value ?? null
    });
  }

  stateAssertionStarted(operation: StatePlanOperation): void {
    this.operationEvent(operation, "adapter.assert-state.started", true, {
      expectedMatchCount: operation.target.expectedMatchCount
    });
  }

  stateAssertionCompleted(operation: StatePlanOperation): void {
    this.operationEvent(operation, "adapter.assert-state.completed", true, {
      expectedMatchCount: operation.target.expectedMatchCount
    });
  }

  modalitySelected(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision
  ): void {
    this.operationEvent(operation, "profile.modality.selected", true, {
      command: decision.command,
      inputModalityProfileId: decision.inputModalityProfile.id,
      modalityId: decision.modality.id
    });
  }

  transitionStarted(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision
  ): void {
    this.operationEvent(operation, "adapter.perform-transition.started", true, {
      command: decision.command
    });
  }

  transitionCompleted(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision
  ): void {
    this.operationEvent(operation, "adapter.perform-transition.completed", true, {
      command: decision.command
    });
  }

  effectRecorded(
    operation: TransitionPlanOperation,
    effect: ResolvedEffect
  ): void {
    this.operationEvent(operation, "effect.recorded", true, {
      effectId: effect.id,
      producedRefs: effect.producedRefs,
      consumedRefs: effect.consumedRefs
    });
  }

  controlFlowStarted(operation: ControlFlowPlanOperation): void {
    this.operationEvent(operation, "adapter.control-flow.started", true);
  }

  controlFlowCompleted(operation: ControlFlowPlanOperation): void {
    this.operationEvent(operation, "adapter.control-flow.completed", true);
  }

  observerExecutionStarted(observer: JourneyObserver): void {
    this.sink.emit({
      type: "observer.execution-started.started",
      ok: true,
      data: componentEvidence(observer)
    });
  }

  observerExecutionStartCompleted(observer: JourneyObserver): void {
    this.sink.emit({
      type: "observer.execution-started.completed",
      ok: true,
      data: componentEvidence(observer)
    });
  }

  observerExecutionStartFailed(observer: JourneyObserver, error: unknown): void {
    this.sink.emit({
      type: "observer.execution-started.failed",
      ok: false,
      data: componentEvidence(observer),
      error: toEvidenceError(error)
    });
  }

  observerExecutionCompleted(observer: JourneyObserver): void {
    this.sink.emit({
      type: "observer.execution-completed.started",
      ok: true,
      data: componentEvidence(observer)
    });
  }

  observerExecutionCompletionCompleted(observer: JourneyObserver): void {
    this.sink.emit({
      type: "observer.execution-completed.completed",
      ok: true,
      data: componentEvidence(observer)
    });
  }

  observerExecutionCompletionFailed(observer: JourneyObserver, error: unknown): void {
    this.sink.emit({
      type: "observer.execution-completed.failed",
      ok: false,
      data: componentEvidence(observer),
      error: toEvidenceError(error)
    });
  }

  private operationEvent(
    operation: JourneyPlanOperation,
    type: string,
    ok: boolean,
    data?: JsonObject
  ): void {
    this.sink.emit({
      type,
      operationId: operation.id,
      operationKind: operation.kind,
      ok,
      references: referencesForOperation(this.context.plan, operation),
      data
    });
  }
}

function toEvidenceError(error: unknown): EvidenceError {
  if (isEvidenceError(error)) return error;
  return errorToEvidence(error);
}

function isEvidenceError(value: unknown): value is EvidenceError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as EvidenceError).name === "string" &&
    typeof (value as EvidenceError).message === "string"
  );
}
