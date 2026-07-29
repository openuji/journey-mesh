import type {
  AxeAuditReport,
  AxeAuditMetadata,
  AxeAuditScanId,
  AxeAuditScanSummaries,
  AxePathAuditFinding,
  AxePathAuditFindings,
  AxePathAuditItem,
  AxePathAuditItemInput,
  AxePathAuditReport,
  AxeResults,
  AxeRuleResultType
} from "../types.js";
import {
  auditHtmlFileName,
  auditJsonFileName,
  axeNodeHtmlHref
} from "../artifacts/report-file-names.js";
import { summarizePathItems, summarizeResults } from "./report-summary.js";
import { stringTargets } from "../shared/strings.js";

export function buildAxePathAuditReport(input: {
  reportId: string;
  createdAt?: string;
  metadata?: AxeAuditMetadata;
  items: AxePathAuditItemInput[];
}): AxePathAuditReport {
  const items = input.items.map(buildAxePathItem);
  return {
    schemaVersion: "ujg-fed-a11y.axe-path.v1",
    reportId: input.reportId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    metadata: input.metadata ?? {},
    summary: summarizePathItems(items),
    items
  };
}

function buildAxePathItem(input: AxePathAuditItemInput): AxePathAuditItem {
  if ("report" in input) {
    const report = input.report;
    return {
      itemId: input.itemId,
      groupId: input.groupId,
      groupLabel: input.groupLabel,
      status: "audited",
      metadata: input.metadata ?? report.metadata,
      auditId: report.auditId,
      createdAt: report.createdAt,
      url: report.url,
      strict: report.strict,
      wcagTags: report.wcagTags,
      sourceJsonHref: auditJsonFileName(report.auditId),
      sourceHtmlHref: auditHtmlFileName(report.auditId),
      sourceScreenshotHref: input.sourceScreenshotHref,
      sourceScreenshotError: input.sourceScreenshotError,
      summary: report.summary,
      scanSummaries: buildScanSummaries(report),
      findings: buildPathFindings(report)
    };
  }

  return {
    itemId: input.itemId,
    groupId: input.groupId,
    groupLabel: input.groupLabel,
    status: input.status,
    reason: input.reason,
    metadata: input.metadata ?? {},
    sourceScreenshotHref: input.sourceScreenshotHref,
    sourceScreenshotError: input.sourceScreenshotError
  };
}

function buildScanSummaries(report: AxeAuditReport): AxeAuditScanSummaries {
  return {
    "page-state": summarizeResults(report.scans.pageState),
    "matched-surface": summarizeResults(report.scans.matchedSurface)
  };
}

function buildPathFindings(report: AxeAuditReport): AxePathAuditFindings {
  return {
    violations: [
      ...scanFindings(report, "page-state", "violation", report.scans.pageState),
      ...scanFindings(report, "matched-surface", "violation", report.scans.matchedSurface)
    ],
    incomplete: [
      ...scanFindings(report, "page-state", "incomplete", report.scans.pageState),
      ...scanFindings(report, "matched-surface", "incomplete", report.scans.matchedSurface)
    ]
  };
}

function scanFindings(
  report: AxeAuditReport,
  scanId: AxeAuditScanId,
  resultType: AxeRuleResultType,
  results: AxeResults
): AxePathAuditFinding[] {
  const ruleResults = resultType === "violation" ? results.violations : results.incomplete;
  return ruleResults.map((result) => ({
    type: resultType,
    scanId,
    ruleId: result.id,
    impact: result.impact ?? undefined,
    help: result.help,
    helpUrl: result.helpUrl,
    description: result.description,
    nodes: result.nodes.map((node, nodeIndex) => ({
      nodeIndex,
      target: stringTargets(node),
      failureSummary: node.failureSummary ?? undefined,
      htmlHref: axeNodeHtmlHref(report.auditId, scanId, resultType, result.id, nodeIndex)
    }))
  }));
}
