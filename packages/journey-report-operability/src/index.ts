/**
 * Report interpreter for the operability observer: joins each transition's input decision and
 * recorded commands with the declared materialization steps of the plan and the operation outcomes.
 * Reads the run record only; no browser runtime.
 */
import { immutableSnapshot } from "@openuji/journey-core";
import type {
  JourneyPlanOperation,
  ResolvedAccessibleLocator,
  ResolvedMaterializationStep,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";
import { noOptions } from "@openuji/journey-plugin";
import { defineInterpreter } from "@openuji/journey-reporter/interpreter";
import type { TestRecord } from "@openuji/journey-run-record";
import {
  isOperabilityOutput,
  operabilityObserverKind,
  type OperabilityEvidence
} from "@openuji/journey-observer-operability/evidence";

export const operabilityReportFormat = "journey-mesh/operability";
export const operabilityReportName = "operability.json";
export const operabilityReportLabel = "Input steps";

export type OperabilityStepStatus = "completed" | "failed" | "attempted" | "not-performed";

export type OperabilityLocatorSummary = Readonly<{ id: string; role?: string; name?: string }>;

/** One declared step, or one command without a declared step (such as typing), and what happened to it. */
export type OperabilityStepReport = Readonly<{
  position: number;
  stepId?: string;
  label?: string;
  /** `move`, `activation` or `shortcut` for declared steps; the adapter command otherwise, such as `text-entry`. */
  kind: string;
  moveKindId?: string;
  locator?: OperabilityLocatorSummary;
  /** The concrete key or pointer action the adapter used. */
  gesture?: string;
  status: OperabilityStepStatus;
  error?: string;
}>;

export type OperabilityInput = Readonly<{
  modalityId: string;
  modalityLabel?: string;
  inputModalityProfileId: string;
  materialization?: Readonly<{ id: string; label?: string }>;
}>;

export type OperabilityTransitionReport = Readonly<{
  operationId: string;
  sequence: number;
  transitionId: string;
  label: string;
  segment?: string;
  phaseId?: string;
  outcome: "passed" | "failed" | "not-executed";
  error?: string;
  /** Absent when the transition declares no input or was not reached. */
  input?: OperabilityInput;
  steps: readonly OperabilityStepReport[];
}>;

export type OperabilityExecutionReport = Readonly<{
  executionId: string;
  profileId: string;
  transitions: readonly OperabilityTransitionReport[];
}>;

export type OperabilityReport = Readonly<{
  format: typeof operabilityReportFormat;
  observerId: string;
  runId: string;
  planId: string;
  /** Transitions in these phases are left out, as in the rest of the report. */
  excludedPhaseIds: readonly string[];
  summary: Readonly<{ transitions: number; materialized: number; steps: number; failedSteps: number }>;
  executions: readonly OperabilityExecutionReport[];
}>;

export function buildOperabilityReport(input: Readonly<{
  observerId: string;
  test: Pick<TestRecord, "plan" | "result">;
  evidence: OperabilityEvidence;
  excludedPhaseIds: readonly string[];
}>): OperabilityReport {
  const { test, evidence, excludedPhaseIds } = input;
  const transitions = test.plan.operations.filter((operation): operation is TransitionPlanOperation =>
    operation.kind === "transition" && !excludedPhaseIds.includes(phaseOf(operation) ?? ""));
  const executions = test.result.executions.map((execution): OperabilityExecutionReport => {
    const outcomes = test.result.evidence.executions.find((item) => item.executionId === execution.executionId)?.operations ?? [];
    return {
      executionId: execution.executionId,
      profileId: execution.profileId,
      transitions: transitions.map((operation): OperabilityTransitionReport => {
        const recorded = outcomes.find((item) => item.operationId === operation.id);
        const decision = evidence.decisions.find((item) => item.executionId === execution.executionId && item.operationId === operation.id);
        const actions = evidence.actions.filter((item) => item.executionId === execution.executionId && item.operationId === operation.id);
        const materialization = decision?.materializationId
          ? operation.materializations?.find((item) => item.id === decision.materializationId)
          : undefined;
        const declared = materialization?.steps ?? [];
        const steps: OperabilityStepReport[] = declared.map((step, index) => {
          const action = actions.filter((item) => item.stepId === step.id).at(-1);
          return {
            ...declaredStep(step, index + 1),
            ...(action?.gesture ? { gesture: action.gesture } : {}),
            status: action?.status ?? "not-performed",
            ...(action?.error ? { error: action.error.message } : {})
          };
        });
        for (const action of actions.filter((item) => !item.stepId || !declared.some((step) => step.id === item.stepId))) {
          steps.push({
            position: steps.length + 1,
            ...(action.stepId ? { stepId: action.stepId } : {}),
            kind: action.command,
            ...(action.gesture ? { gesture: action.gesture } : {}),
            status: action.status,
            ...(action.error ? { error: action.error.message } : {})
          });
        }
        const phaseId = phaseOf(operation);
        return {
          operationId: operation.id,
          sequence: operation.sequence,
          transitionId: operation.transition.id,
          label: operation.transition.label ?? operation.activation.transitionLabel ?? operation.transition.id,
          ...(operation.segment ? { segment: operation.segment } : {}),
          ...(phaseId ? { phaseId } : {}),
          outcome: recorded ? recorded.outcome.kind : "not-executed",
          ...(recorded?.outcome.kind === "failed" ? { error: recorded.outcome.error.message } : {}),
          ...(decision ? {
            input: {
              modalityId: decision.modalityId,
              ...(decision.modalityLabel ? { modalityLabel: decision.modalityLabel } : {}),
              inputModalityProfileId: decision.inputModalityProfileId,
              ...(decision.materializationId ? {
                materialization: { id: decision.materializationId, ...(materialization?.label ? { label: materialization.label } : {}) }
              } : {})
            }
          } : {}),
          steps
        };
      })
    };
  });
  const all = executions.flatMap((execution) => execution.transitions);
  const steps = all.flatMap((transition) => transition.steps);
  return immutableSnapshot({
    format: operabilityReportFormat,
    observerId: input.observerId,
    runId: test.result.runId,
    planId: test.plan.id,
    excludedPhaseIds: [...excludedPhaseIds],
    summary: {
      transitions: all.length,
      materialized: all.filter((transition) => transition.input?.materialization).length,
      steps: steps.length,
      failedSteps: steps.filter((step) => step.status === "failed").length
    },
    executions
  });
}

function declaredStep(step: ResolvedMaterializationStep, position: number): Omit<OperabilityStepReport, "status"> {
  return {
    position,
    stepId: step.id,
    ...(step.label ? { label: step.label } : {}),
    kind: step.kind,
    ...(step.moveKind ? { moveKindId: step.moveKind.id } : {}),
    ...(step.locator ? { locator: locatorSummary(step.locator) } : {})
  };
}

function locatorSummary(locator: ResolvedAccessibleLocator): OperabilityLocatorSummary {
  return {
    id: locator.id,
    ...(locator.role ? { role: locator.role } : {}),
    ...(locator.accessibleName ? { name: locator.accessibleName } : {})
  };
}

function phaseOf(operation: JourneyPlanOperation): string | undefined {
  const phaseId = operation.source?.references?.phaseId;
  return typeof phaseId === "string" ? phaseId : undefined;
}

export const journeyMeshInterpreter = defineInterpreter({
  kind: operabilityObserverKind,
  parse: (options) => noOptions(options),
  interpret({ test, output, excludedPhaseIds }) {
    if (!isOperabilityOutput(output)) throw new Error(`Observer ${output.id} has no recorded operability evidence`);
    const report = buildOperabilityReport({ observerId: output.id, test, evidence: output.evidence, excludedPhaseIds });
    return { data: [{ name: operabilityReportName, format: operabilityReportFormat, label: operabilityReportLabel, value: report }] };
  }
});
