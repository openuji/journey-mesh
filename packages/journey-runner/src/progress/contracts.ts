import type { JourneyPlanOperation } from "@openuji/journey-execution-model";

import type { JourneyRunError } from "../errors.js";
import type { ExecutionResult, JourneyProfileAssessment } from "../results/contracts.js";

export type JourneyProgressEvent =
  | { readonly type: "run-started"; readonly runId: string; readonly planId: string; readonly profileCount: number; readonly operationsPerProfile: number }
  | { readonly type: "profiles-assessed"; readonly runId: string; readonly assessments: readonly JourneyProfileAssessment[] }
  | { readonly type: "execution-started"; readonly runId: string; readonly executionId: string; readonly profileId: string }
  | { readonly type: "operation-started"; readonly executionId: string; readonly profileId: string; readonly operation: JourneyPlanOperation; readonly position: number; readonly total: number }
  | { readonly type: "operation-completed"; readonly executionId: string; readonly profileId: string; readonly operation: JourneyPlanOperation; readonly position: number; readonly total: number; readonly durationMs: number }
  | { readonly type: "operation-failed"; readonly executionId: string; readonly profileId: string; readonly operation: JourneyPlanOperation; readonly position: number; readonly total: number; readonly durationMs: number; readonly error: JourneyRunError }
  | { readonly type: "execution-completed"; readonly result: ExecutionResult; readonly durationMs: number }
  | { readonly type: "run-completed"; readonly runId: string; readonly ok: boolean; readonly durationMs: number };

export type JourneyProgressSink = {
  readonly name?: string;
  publish(event: JourneyProgressEvent): Promise<void> | void;
};
