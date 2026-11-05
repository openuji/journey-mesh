import type { JourneyPlan } from "@openuji/journey-execution-model";

import type { JourneyRunError } from "../errors.js";
import type {
  ExecutionResult,
  JourneyExecutionEvidence,
  JourneyProfileAssessment,
  RunResult
} from "./contracts.js";
import { executionPassed } from "./outcomes.js";

/** Derive diagnostics and pass/fail once from immutable assessment and execution values. */
export function buildResult(input: {
  runErrors: readonly JourneyRunError[];
  assessments: readonly JourneyProfileAssessment[];
  evidenceExecutions: readonly JourneyExecutionEvidence[];
  executions: readonly ExecutionResult[];
  plan: JourneyPlan;
  runId: string;
}): RunResult {
  const { runErrors, assessments, evidenceExecutions, executions, plan, runId } = input;
  const noApplicableProfiles = assessments.length > 0 &&
    assessments.every((assessment) => assessment.kind === "not-applicable");
  const errors = Object.freeze([
    ...runErrors,
    ...assessments.flatMap((assessment) => assessment.kind === "failed" ? [assessment.error] : []),
    ...executions.flatMap((execution) => execution.outcome.kind === "failed" ? [execution.outcome.error] : []),
    ...(noApplicableProfiles ? [{
      name: "NoApplicableProfileExecutionsError",
      message: "No applicable profile executions"
    }] : [])
  ].map((error) => Object.freeze({ ...error })));

  return Object.freeze({
    ok: errors.length === 0 && executions.length > 0 && executions.every(executionPassed),
    runId,
    plan: planSnapshot(plan),
    assessments: Object.freeze([...assessments]),
    executions: Object.freeze([...executions]),
    evidence: Object.freeze({ executions: Object.freeze([...evidenceExecutions]) }),
    errors
  });
}

function planSnapshot(plan: JourneyPlan): RunResult["plan"] {
  if (!plan.source) return Object.freeze({ id: plan.id });
  const source = plan.source;
  return Object.freeze({
    id: plan.id,
    source: Object.freeze({
      model: source.model,
      ...(source.documentId !== undefined ? { documentId: source.documentId } : {}),
      ...(source.references ? {
        references: Object.freeze(Object.fromEntries(Object.entries(source.references).map(([key, value]) => [
          key, typeof value === "string" ? value : Object.freeze([...value])
        ])))
      } : {})
    })
  });
}
