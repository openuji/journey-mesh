import type { JourneyOperationSource, JourneyPlanOperationKind, JourneyPlanSource } from "@openuji/journey-execution-model";

import type { JourneyRunError } from "../errors.js";
import type { JourneyComponentDescriptor, JourneyProfileDescriptor } from "../observers/contracts.js";

export type JourneyOutcome =
  | Readonly<{ kind: "passed" }>
  | Readonly<{ kind: "failed"; error: JourneyRunError }>;

/** Applicability is assessed before execution and never becomes an execution outcome. */
export type JourneyProfileAssessment =
  | Readonly<{ kind: "applicable"; profile: JourneyProfileDescriptor }>
  | Readonly<{ kind: "not-applicable"; profile: JourneyProfileDescriptor; reason: string }>
  | Readonly<{ kind: "failed"; profile: JourneyProfileDescriptor; error: JourneyRunError }>;

export type ExecutionResult = Readonly<{
  executionId: string;
  profileId: string;
  outcome: JourneyOutcome;
}>;

export type JourneyOperationEvidence = Readonly<{
  operationId: string;
  graphNodeId?: string;
  operationKind: JourneyPlanOperationKind;
  source?: JourneyOperationSource;
  adapter?: JourneyComponentDescriptor;
  outcome: JourneyOutcome;
}>;

export type JourneyExecutionEvidence = Readonly<{
  executionId: string;
  profileId: string;
  operations: readonly JourneyOperationEvidence[];
}>;

/** Immutable report snapshot; ok and errors are derived by the result builder. */
export type RunResult = Readonly<{
  ok: boolean;
  runId: string;
  plan: Readonly<{ id: string; source?: JourneyPlanSource }>;
  assessments: readonly JourneyProfileAssessment[];
  executions: readonly ExecutionResult[];
  evidence: Readonly<{ executions: readonly JourneyExecutionEvidence[] }>;
  errors: readonly JourneyRunError[];
}>;
