import type { JourneyPlanOperationKind, JourneyPlanSource } from "@openuji/journey-execution-model";

import type { JourneyRunError } from "../errors.js";

export type ExecutionResult = {
  executionId: string;
  profileId: string;
  ok: boolean;
  error?: JourneyRunError;
};

export type JourneyOperationEvidence = {
  operationId: string;
  operationKind: JourneyPlanOperationKind;
  ok: boolean;
  error?: JourneyRunError;
};

export type JourneyExecutionEvidence = {
  executionId: string;
  profileId: string;
  operations: JourneyOperationEvidence[];
};

export type RunResult = {
  ok: boolean;
  runId: string;
  plan: { id: string; source?: JourneyPlanSource };
  executions: ExecutionResult[];
  evidence: { executions: JourneyExecutionEvidence[] };
  errors: JourneyRunError[];
};
