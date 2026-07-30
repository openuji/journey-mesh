import type { JourneyPlan } from "@openuji/journey-execution-model";

import type { JourneyRunError } from "../errors.js";
import type { ExecutionResult, JourneyExecutionEvidence, RunResult } from "./contracts.js";

export function resultOk(executions: readonly ExecutionResult[], errors: readonly JourneyRunError[]): boolean {
  return errors.length === 0 && executions.every((execution) => execution.ok);
}

export function buildResult({
  errors,
  evidenceExecutions,
  executions,
  ok,
  plan,
  runId
}: {
  errors: readonly JourneyRunError[];
  evidenceExecutions: readonly JourneyExecutionEvidence[];
  executions: readonly ExecutionResult[];
  ok: boolean;
  plan: JourneyPlan;
  runId: string;
}): RunResult {
  return {
    ok,
    runId,
    plan: { id: plan.id, ...(plan.source ? { source: plan.source } : {}) },
    executions: executions.map((execution) => ({ ...execution })),
    evidence: {
      executions: evidenceExecutions.map((execution) => ({
        executionId: execution.executionId,
        profileId: execution.profileId,
        operations: execution.operations.map((operation) => ({ ...operation }))
      }))
    },
    errors: errors.map((error) => ({ ...error }))
  };
}
