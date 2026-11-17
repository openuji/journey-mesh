import { playwrightAdapterName } from "@openuji/journey-adapter-playwright";
import type { RunResult } from "@openuji/journey-runner";
import { observedOperations, routedElsewhere, type ObservedOperation } from "@openuji/journey-plugin";
import { shouldFailForAxeViolations } from "../audit/strict-mode.js";
import { auditedAxePathItem, createAxeJourneyItem, unauditedAxePathItem } from "../journey/journey-item.js";
import { planSourceMetadata } from "../journey/operation-metadata.js";
import type { AxeEvidence, AxeOperationEvidence, AxeScreenshotEvidence } from "../observer/evidence.js";
import { immutableSnapshot, type Immutable, type JourneyNodeSummary } from "@openuji/journey-core";
import type {
  AxeAuditMetadata,
  AxeAuditReport,
  AxeJourneyOperation,
  AxePathAuditItemInput,
  AxePathAuditReport,
  AxePathSourceScreenshotFields
} from "../types.js";
import { buildAxePathAuditReport } from "./path-audit-report.js";

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
    items: buildAxePathItems(input.evidence, input.result)
  });
}

export function buildAxePathItems(evidence: readonly AxeEvidence[], result: RunResult): readonly AxePathAuditItemInput[] {
  return immutableSnapshot(observedOperations(evidence, result).map(projectPathItem));
}

/** Strict mode derives from every completed scan, including superseded observations. */
export function strictAxeFailureReports(evidence: readonly AxeEvidence[], runId: string): readonly AxeAuditReport[] {
  return Object.freeze(evidence.flatMap((fact) => {
    if (fact.kind !== "operation-observed" || fact.evidence.runId !== runId || !("audit" in fact.evidence)) return [];
    const audit = fact.evidence.audit;
    return audit.kind === "completed" && shouldFailForAxeViolations(audit.report) ? [audit.report] : [];
  }));
}

function projectPathItem(target: ObservedOperation<AxeOperationEvidence>): AxePathAuditItemInput {
  const { observed } = target;
  const item = createAxeJourneyItem(target.profileId, target.executionId, target.operation as AxeJourneyOperation);
  if (routedElsewhere(target, playwrightAdapterName)) {
    return unauditedAxePathItem(item, "not-applicable", `Operation was routed to adapter ${target.attempted!.adapter!.name}; no Playwright accessibility surface was observed.`);
  }
  if (!observed) {
    if (target.operation.kind === "control-flow") {
      return unauditedAxePathItem(item, "not-applicable", "Control-flow items do not resolve to a page surface.");
    }
    if (target.operation.kind === "state" && target.operation.target.expectedMatchCount !== 1) {
      return unauditedAxePathItem(item, "skipped", unmatchedSurfaceReason(target.operation.target.expectedMatchCount));
    }
    return unauditedAxePathItem(item, "skipped", "Plan item was not audited because the runner ended before this item could be scanned.");
  }
  if ("notApplicable" in observed) {
    return unauditedAxePathItem(item, "not-applicable", observed.notApplicable.reason);
  }
  if (observed.stage === "control-flow-recorded") {
    return unauditedAxePathItem(item, "not-applicable", "Control-flow items do not resolve to a page surface.");
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

/** Journey-map node footers: page and surface counts for audited items, `skipped` when an audit was expected but missing. */
export function axeNodeSummaries(report: AxePathAuditReport): readonly JourneyNodeSummary[] {
  return immutableSnapshot(report.items.flatMap((item): JourneyNodeSummary[] => {
    const executionId = item.metadata.executionId;
    const operationId = item.metadata.operationId;
    if (typeof executionId !== "string" || typeof operationId !== "string" || item.status === "not-applicable") return [];
    if (item.status === "skipped") return [{ executionId, operationId, metrics: { kind: "skipped", ...(item.reason ? { reason: item.reason } : {}) } }];
    return [{ executionId, operationId, metrics: { kind: "axe", ...(item.scanSummaries ? { pageState: item.scanSummaries["page-state"], matchedSurface: item.scanSummaries["matched-surface"] } : {}) } }];
  }));
}
