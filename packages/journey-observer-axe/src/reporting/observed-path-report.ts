import type { RunResult } from "@openuji/journey-runner";
import { shouldFailForAxeViolations } from "../audit/strict-mode.js";
import { auditedAxePathItem, createAxeJourneyItem, itemKey, unauditedAxePathItem } from "../journey/journey-item.js";
import { planSourceMetadata } from "../journey/operation-metadata.js";
import type { AxeEvidence, AxeOperationEvidence, AxeScreenshotEvidence } from "../observer/evidence.js";
import { immutableSnapshot, type Immutable } from "../shared/immutable.js";
import type {
  AxeAuditMetadata,
  AxeAuditReport,
  AxeJourneyOperation,
  AxePathAuditItemInput,
  AxePathAuditReport,
  AxePathSourceScreenshotFields
} from "../types.js";
import { buildAxePathAuditReport } from "./path-audit-report.js";

type PlannedOperation = Readonly<{
  executionId: string;
  profileId: string;
  operation: AxeJourneyOperation;
}>;

/** Report policy is a pure projection of plan snapshots and collected evidence. */
export function buildAxeObservedPathReport(input: {
  reportId: string;
  createdAt: string;
  result: RunResult;
  evidence: readonly AxeEvidence[];
  wcagTags: readonly string[];
  metadata?: Immutable<AxeAuditMetadata>;
}): AxePathAuditReport {
  const sourceMetadata = planSourceMetadata(input.result.plan.source);
  return buildAxePathAuditReport({
    reportId: input.reportId,
    createdAt: input.createdAt,
    wcagTags: input.wcagTags,
    metadata: {
      ...(input.metadata ?? {}),
      runId: input.result.runId,
      planId: input.result.plan.id,
      ...(sourceMetadata ? { planSource: sourceMetadata } : {}),
      executionCount: input.result.executions.length,
      notApplicableProfileCount: input.result.assessments.filter((assessment) => assessment.kind === "not-applicable").length
    },
    items: buildAxePathItems(input.evidence, input.result.runId)
  });
}

export function buildAxePathItems(evidence: readonly AxeEvidence[], runId: string): readonly AxePathAuditItemInput[] {
  const facts = evidence.filter((fact) => factRunId(fact) === runId);
  const candidates = facts.flatMap((fact): readonly PlannedOperation[] => fact.kind === "execution-started"
    ? fact.execution.plan.operations.map((operation) => ({
      executionId: fact.execution.executionId, profileId: fact.execution.profile.id, operation
    }))
    : [fact.evidence]);
  const planned = candidates.filter((candidate, index) => candidates.findIndex((other) =>
    itemKey(other.executionId, other.operation.id) === itemKey(candidate.executionId, candidate.operation.id)
  ) === index);

  return immutableSnapshot(planned.map((target) => {
    const observed = facts.reduce<AxeOperationEvidence | undefined>((previous, fact) =>
      fact.kind === "operation-observed" &&
      fact.evidence.executionId === target.executionId && fact.evidence.operation.id === target.operation.id
        ? fact.evidence : previous,
    undefined);
    return projectPathItem(observed ? { ...target, operation: observed.operation } : target, observed);
  }));
}

/** Strict mode derives from every completed scan, including superseded observations. */
export function strictAxeFailureReports(evidence: readonly AxeEvidence[], runId: string): readonly AxeAuditReport[] {
  return Object.freeze(evidence.flatMap((fact) => {
    if (fact.kind !== "operation-observed" || fact.evidence.runId !== runId || !("audit" in fact.evidence)) return [];
    const audit = fact.evidence.audit;
    return audit.kind === "completed" && shouldFailForAxeViolations(audit.report) ? [audit.report] : [];
  }));
}

function projectPathItem(target: PlannedOperation, observed: AxeOperationEvidence | undefined): AxePathAuditItemInput {
  const item = createAxeJourneyItem(target.profileId, target.executionId, target.operation);
  if (target.operation.kind === "control-flow" || observed?.stage === "control-flow-recorded") {
    return unauditedAxePathItem(item, "not-applicable", "Control-flow items do not resolve to a page surface.");
  }
  if (!observed) {
    if (target.operation.kind === "state" && target.operation.target.expectedMatchCount !== 1) {
      return unauditedAxePathItem(item, "skipped", unmatchedSurfaceReason(target.operation.target.expectedMatchCount));
    }
    return unauditedAxePathItem(item, "skipped", "Plan item was not audited because the runner ended before this item could be scanned.");
  }
  if (observed.stage === "transition-completed") {
    return unauditedAxePathItem(item, "not-applicable", "No-input transition completed without a locator; no scoped accessibility audit was performed.");
  }
  const screenshot = screenshotFields(observed.screenshot);
  if (observed.audit.kind === "completed") return auditedAxePathItem(item, observed.audit.report, screenshot);
  if (observed.audit.kind === "failed") {
    const prefix = observed.screenshot.kind === "captured" ? "State source screenshot captured, but the axe audit did not complete" : "Axe audit did not complete";
    return unauditedAxePathItem(item, "skipped", `${prefix}: ${observed.audit.error.message}`, screenshot);
  }
  return unauditedAxePathItem(item, "skipped", unmatchedSurfaceReason(observed.expectedMatchCount), screenshot);
}

function screenshotFields(screenshot: AxeScreenshotEvidence): AxePathSourceScreenshotFields {
  switch (screenshot.kind) {
    case "not-requested": return {};
    case "captured": return { sourceScreenshotHref: screenshot.href };
    case "failed": return { sourceScreenshotError: screenshot.error.message };
  }
}

function unmatchedSurfaceReason(count: number): string {
  return `Expected match count ${count} cannot be scoped to one matched locator.`;
}

function factRunId(fact: AxeEvidence): string {
  return fact.kind === "execution-started" ? fact.execution.runId : fact.evidence.runId;
}
