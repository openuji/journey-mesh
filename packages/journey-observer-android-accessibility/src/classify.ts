import type { JourneyPlanOperation, JourneyOutcome, RunResult } from "@openuji/journey-runner";
import type { AndroidAccessibilityEvidence, AndroidOperationEvidence } from "./evidence.js";
import type { AndroidHierarchyCheck } from "./hierarchy.js";
import { immutableSnapshot, type Immutable } from "@openuji/journey-core";
import { observedOperations, routedElsewhere } from "@openuji/journey-plugin";

/** `JourneyObserverOutput.kind` of this observer. */
export const androidAccessibilityKind = "android-accessibility";
/**
 * The adapter this observer observes. Kept as a literal so evidence consumers need no device runtime;
 * a test checks it equals `appiumAdapterName`.
 */
export const androidAdapterName = "@openuji/journey-adapter-appium";

/** How one planned operation of one execution was assessed. */
export type AndroidOperationAssessment = Immutable<{
  executionId: string; profileId: string; operationId: string;
  kind: JourneyPlanOperation["kind"];
  status: "checked" | "skipped" | "not-applicable" | "error";
  reason?: string; outcome?: JourneyOutcome;
  checks: readonly AndroidHierarchyCheck[];
  observation?: AndroidOperationEvidence;
}>;

/** Every planned operation of every execution, once, with why it was or was not checked. Pure. */
export function assessAndroidOperations(evidence: readonly AndroidAccessibilityEvidence[], result: RunResult): readonly AndroidOperationAssessment[] {
  return immutableSnapshot(observedOperations<AndroidOperationEvidence>(evidence, result).map((target): AndroidOperationAssessment => {
    const { observed: observation, attempted, operation } = target;
    const base = { executionId: target.executionId, profileId: target.profileId, operationId: operation.id, kind: operation.kind, ...(attempted ? { outcome: attempted.outcome } : {}), checks: observation?.checks ?? [], ...(observation ? { observation } : {}) };
    if (observation?.notApplicable) return { ...base, status: "not-applicable", reason: observation.notApplicable.reason };
    if (routedElsewhere(target, androidAdapterName)) return { ...base, status: "not-applicable", reason: `Operation was routed to adapter ${attempted!.adapter!.name}; no native hierarchy was observed.` };
    if (operation.kind === "control-flow" || observation?.stage === "control-flow-recorded") return { ...base, status: "not-applicable", reason: "Control flow has no native surface." };
    if (observation?.stage === "transition-completed") return { ...base, status: "not-applicable", reason: "No-input transition completed without a native target." };
    if (!observation) return { ...base, status: "skipped", reason: attempted?.outcome.kind === "failed" ? `Operation failed before hierarchy collection: ${attempted.outcome.error.message}` : "No native evidence was collected before execution ended." };
    if ([observation.hierarchy, observation.metrics, observation.screenshot].some((capture) => capture?.kind === "failed")) return { ...base, status: "error", reason: "Configured native evidence collection did not complete." };
    return { ...base, status: "checked" };
  }));
}

/** Strict policy examines all completed checks, including superseded observations. */
export function androidAccessibilityFindings(evidence: readonly AndroidAccessibilityEvidence[], runId: string): readonly AndroidHierarchyCheck[] {
  return Object.freeze(evidence.flatMap((fact) => fact.kind === "operation-observed" && fact.evidence.runId === runId ? fact.evidence.checks.filter((check) => check.status === "finding") : []));
}
