import type { PlaywrightOperationObservation } from "@openuji/journey-executor-playwright";
import type {
  JourneyExecutionDescriptor,
  JourneyRunError,
  StatePlanOperation,
  TransitionPlanOperation,
  ControlFlowPlanOperation
} from "@openuji/journey-runner";

import type { AxeAuditReport } from "../types.js";
import type { Immutable } from "@openuji/journey-core";

/** A file registered in the run's evidence store; `href` is relative to the run directory. */
export type AxeEvidenceRef = Readonly<{ href: string }>;

export type AxeScreenshotEvidence =
  | Readonly<{ kind: "not-requested" }>
  | Readonly<{ kind: "captured"; href: string }>
  | Readonly<{ kind: "failed"; error: JourneyRunError }>;

export type AxeAuditEvidence =
  | Readonly<{ kind: "not-requested" }>
  | Readonly<{ kind: "completed"; report: AxeAuditReport; document?: AxeEvidenceRef }>
  | Readonly<{ kind: "failed"; error: JourneyRunError }>;

type OperationIdentity = {
  runId: string;
  executionId: string;
  profileId: string;
};

export type AxeOperationEvidence = Immutable<OperationIdentity & (
  | {
      stage: PlaywrightOperationObservation["stage"];
      operation: StatePlanOperation | TransitionPlanOperation | ControlFlowPlanOperation;
      notApplicable: { phaseId: string; reason: string };
    }
  | { stage: "control-flow-recorded"; operation: ControlFlowPlanOperation }
  | { stage: "transition-completed"; operation: TransitionPlanOperation }
  | {
      stage: "state-asserted" | "transition-ready";
      operation: StatePlanOperation | TransitionPlanOperation;
      expectedMatchCount: number;
      screenshot: AxeScreenshotEvidence;
      audit: AxeAuditEvidence;
    }
)>;

export type AxeEvidence =
  | Immutable<{ kind: "execution-started"; execution: JourneyExecutionDescriptor }>
  | Readonly<{ kind: "operation-observed"; evidence: AxeOperationEvidence }>;

export type PageSurfaceObservation = Extract<
  PlaywrightOperationObservation,
  { stage: "state-asserted" | "transition-ready" }
>;
