import { immutableSnapshot, type Immutable } from "@openuji/journey-core";
import { observedOperations, routedElsewhere, type ObservedOperation } from "@openuji/journey-plugin";
import type { RunResult } from "@openuji/journey-runner";
import {
  addAxeScanSummaries, axeExecutorName, createAxeJourneyItem, emptyScanSummaries, planSourceMetadata, stringTargets, summarizeResults,
  type AxeAuditMetadata, type AxeAuditReport, type AxeAuditScanId, type AxeAuditScanSummaries, type AxeEvidence, type AxeJourneyItem,
  type AxeJourneyOperation, type AxeOperationEvidence, type AxeResults, type AxeRuleResultType, type AxeScreenshotEvidence
} from "@openuji/journey-observer-axe/evidence";
import {
  axePathFormat,
  type AxePathAuditFinding, type AxePathAuditFindings, type AxePathAuditItem, type AxePathAuditItemInput, type AxePathAuditReport,
  type AxePathAuditSummary, type AxePathSourceFields
} from "./types.js";

/** A path report is a pure projection of the plan, the run result, and the observer's journal. */
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

export function buildAxePathAuditReport(input: {
  reportId: string;
  createdAt: string;
  wcagTags?: readonly string[];
  metadata?: Immutable<AxeAuditMetadata>;
  items: readonly AxePathAuditItemInput[];
}): AxePathAuditReport {
  const items = input.items.map(buildAxePathItem);
  return immutableSnapshot({
    format: axePathFormat,
    reportId: input.reportId,
    createdAt: input.createdAt,
    wcagTags: [...(input.wcagTags ?? [])],
    metadata: input.metadata ?? {},
    summary: summarizePathItems(items),
    items
  });
}

export function summarizePathItems(items: readonly AxePathAuditItem[]): AxePathAuditSummary {
  return items.reduce((summary, item) => ({
    items: summary.items + 1,
    audited: summary.audited + (item.status === "audited" ? 1 : 0),
    skipped: summary.skipped + (item.status === "skipped" ? 1 : 0),
    notApplicable: summary.notApplicable + (item.status === "not-applicable" ? 1 : 0),
    violations: summary.violations + (item.summary?.violations ?? 0),
    incomplete: summary.incomplete + (item.summary?.incomplete ?? 0),
    passes: summary.passes + (item.summary?.passes ?? 0),
    inapplicable: summary.inapplicable + (item.summary?.inapplicable ?? 0),
    scanSummaries: addAxeScanSummaries(summary.scanSummaries, item.scanSummaries)
  }), { items: 0, audited: 0, skipped: 0, notApplicable: 0, violations: 0, incomplete: 0, passes: 0, inapplicable: 0, scanSummaries: emptyScanSummaries() } as AxePathAuditSummary);
}

function auditedItem(journeyItem: AxeJourneyItem, report: AxeAuditReport, sources?: AxePathSourceFields): AxePathAuditItemInput {
  return { itemId: journeyItem.itemId, groupId: journeyItem.groupId, groupLabel: journeyItem.groupLabel, metadata: journeyItem.metadata, report, ...sources };
}

function unauditedItem(journeyItem: AxeJourneyItem, status: "skipped" | "not-applicable", reason: string, sources?: AxePathSourceFields): AxePathAuditItemInput {
  return { itemId: journeyItem.itemId, groupId: journeyItem.groupId, groupLabel: journeyItem.groupLabel, metadata: journeyItem.metadata, status, reason, ...sources };
}

function projectPathItem(target: ObservedOperation<AxeOperationEvidence>): AxePathAuditItemInput {
  const { observed } = target;
  const item = createAxeJourneyItem(target.profileId, target.executionId, target.operation as AxeJourneyOperation);
  if (routedElsewhere(target, axeExecutorName)) {
    return unauditedItem(item, "not-applicable", `Operation was routed to executor ${target.attempted!.executor!.name}; no Playwright accessibility surface was observed.`);
  }
  if (!observed) {
    if (target.operation.kind === "control-flow") return unauditedItem(item, "not-applicable", "Control-flow items do not resolve to a page surface.");
    if (target.operation.kind === "state" && target.operation.target.expectedMatchCount !== 1) {
      return unauditedItem(item, "skipped", unmatchedSurfaceReason(target.operation.target.expectedMatchCount));
    }
    return unauditedItem(item, "skipped", "Plan item was not audited because the runner ended before this item could be scanned.");
  }
  if ("notApplicable" in observed) return unauditedItem(item, "not-applicable", observed.notApplicable.reason);
  if (observed.stage === "control-flow-recorded") return unauditedItem(item, "not-applicable", "Control-flow items do not resolve to a page surface.");
  if (observed.stage === "transition-completed") {
    return unauditedItem(item, "not-applicable", "No-input transition completed without a locator; no scoped accessibility audit was performed.");
  }
  const screenshot = screenshotFields(observed.screenshot);
  if (observed.audit.kind === "completed") {
    return auditedItem(item, observed.audit.report, { ...screenshot, ...(observed.audit.document ? { sourceJsonHref: observed.audit.document.href } : {}) });
  }
  if (observed.audit.kind === "failed") {
    const prefix = observed.screenshot.kind === "captured" ? "State source screenshot captured, but the axe audit did not complete" : "Axe audit did not complete";
    return unauditedItem(item, "skipped", `${prefix}: ${observed.audit.error.message}`, screenshot);
  }
  return unauditedItem(item, "skipped", unmatchedSurfaceReason(observed.expectedMatchCount), screenshot);
}

function screenshotFields(screenshot: AxeScreenshotEvidence): AxePathSourceFields {
  switch (screenshot.kind) {
    case "not-requested": return {};
    case "captured": return { sourceScreenshotHref: screenshot.href };
    case "failed": return { sourceScreenshotError: screenshot.error.message };
  }
}

function unmatchedSurfaceReason(count: number): string {
  return `Expected match count ${count} cannot be scoped to one matched locator.`;
}

function buildAxePathItem(input: AxePathAuditItemInput): AxePathAuditItem {
  if ("report" in input) {
    const report = input.report;
    return {
      itemId: input.itemId, groupId: input.groupId, groupLabel: input.groupLabel, status: "audited",
      metadata: input.metadata ?? report.metadata,
      auditId: report.auditId, createdAt: report.createdAt, url: report.url, strict: report.strict, wcagTags: report.wcagTags,
      sourceJsonHref: input.sourceJsonHref, sourceScreenshotHref: input.sourceScreenshotHref, sourceScreenshotError: input.sourceScreenshotError,
      summary: report.summary, scanSummaries: buildScanSummaries(report), findings: buildPathFindings(report)
    };
  }
  return {
    itemId: input.itemId, groupId: input.groupId, groupLabel: input.groupLabel, status: input.status, reason: input.reason,
    metadata: input.metadata ?? {}, sourceScreenshotHref: input.sourceScreenshotHref, sourceScreenshotError: input.sourceScreenshotError
  };
}

function buildScanSummaries(report: AxeAuditReport): AxeAuditScanSummaries {
  return { "page-state": summarizeResults(report.scans.pageState), "matched-surface": summarizeResults(report.scans.matchedSurface) };
}

function buildPathFindings(report: AxeAuditReport): AxePathAuditFindings {
  return {
    violations: [...scanFindings("page-state", "violation", report.scans.pageState), ...scanFindings("matched-surface", "violation", report.scans.matchedSurface)],
    incomplete: [...scanFindings("page-state", "incomplete", report.scans.pageState), ...scanFindings("matched-surface", "incomplete", report.scans.matchedSurface)]
  };
}

function scanFindings(scanId: AxeAuditScanId, resultType: AxeRuleResultType, results: Immutable<AxeResults>): AxePathAuditFinding[] {
  const ruleResults = resultType === "violation" ? results.violations : results.incomplete;
  return ruleResults.map((result) => ({
    type: resultType, scanId, ruleId: result.id, impact: result.impact ?? undefined,
    help: result.help, helpUrl: result.helpUrl, description: result.description,
    nodes: result.nodes.map((node, nodeIndex) => ({ nodeIndex, target: stringTargets(node), failureSummary: node.failureSummary ?? undefined }))
  }));
}
