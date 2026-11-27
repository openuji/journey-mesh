import type { JourneyPlanOperation, JourneyOutcome, RunResult } from "@openuji/journey-runner";
import type { IosAccessibilityEvidence, IosOperationEvidence } from "./evidence.js";
import type { IosHierarchyCheck } from "./hierarchy.js";
import { immutableSnapshot, type Immutable } from "@openuji/journey-core";
import { observedOperations, routedElsewhere } from "@openuji/journey-plugin";

/** `JourneyObserverOutput.kind` of this observer. */
export const iosAccessibilityKind = "ios-accessibility";
/**
 * The executor this observer observes. Kept as a literal so evidence consumers need no device runtime;
 * a test checks it equals `appiumIosExecutorName`.
 */
export const iosExecutorName = "@openuji/journey-executor-appium/ios";

/** How one planned operation of one execution was assessed. */
export type IosOperationAssessment = Immutable<{
  executionId: string;
  profileId: string;
  operationId: string;
  kind: JourneyPlanOperation["kind"];
  status: "checked" | "skipped" | "not-applicable" | "error";
  reason?: string;
  outcome?: JourneyOutcome;
  checks: readonly IosHierarchyCheck[];
  observation?: IosOperationEvidence;
}>;

/** Every planned operation of every execution, once, with why it was or was not checked. Pure. */
export function assessIosOperations(
  evidence: readonly IosAccessibilityEvidence[],
  result: RunResult
): readonly IosOperationAssessment[] {
  return immutableSnapshot(
    observedOperations<IosOperationEvidence>(evidence, result).map((target): IosOperationAssessment => {
      const { observed: observation, attempted, operation } = target;
      const base = {
        executionId: target.executionId,
        profileId: target.profileId,
        operationId: operation.id,
        kind: operation.kind,
        ...(attempted ? { outcome: attempted.outcome } : {}),
        checks: observation?.checks ?? [],
        ...(observation ? { observation } : {})
      };
      if (observation?.notApplicable) return { ...base, status: "not-applicable", reason: observation.notApplicable.reason };
      if (routedElsewhere(target, iosExecutorName)) {
        return {
          ...base,
          status: "not-applicable",
          reason: `Operation was routed to executor ${attempted!.executor!.name}; no native hierarchy was observed.`
        };
      }
      if (operation.kind === "control-flow" || observation?.stage === "control-flow-recorded") {
        return { ...base, status: "not-applicable", reason: "Control flow has no native surface." };
      }
      if (observation?.stage === "transition-completed") {
        return { ...base, status: "not-applicable", reason: "No-input transition completed without a native target." };
      }
      if (!observation) {
        return {
          ...base,
          status: "skipped",
          reason:
            attempted?.outcome.kind === "failed"
              ? `Operation failed before hierarchy collection: ${attempted.outcome.error.message}`
              : "No native evidence was collected before execution ended."
        };
      }
      if ([observation.hierarchy, observation.metrics, observation.screenshot].some((capture) => capture?.kind === "failed")) {
        return { ...base, status: "error", reason: "Configured native evidence collection did not complete." };
      }
      return { ...base, status: "checked" };
    })
  );
}

/** Strict policy examines all completed checks, including superseded observations. */
export function iosAccessibilityFindings(
  evidence: readonly IosAccessibilityEvidence[],
  runId: string
): readonly IosHierarchyCheck[] {
  return Object.freeze(
    evidence.flatMap((fact) =>
      fact.kind === "operation-observed" && fact.evidence.runId === runId
        ? fact.evidence.checks.filter((check) => check.status === "finding")
        : []
    )
  );
}
