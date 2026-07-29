import type {
  AxeAuditReport,
  AxeAuditScanId,
  AxeNode,
  AxeRuleResult,
  AxeRuleResultType,
  AxeResults
} from "../types.js";
import { axeNodeHtmlId } from "../artifacts/report-file-names.js";
import { summarizeResults } from "../reporting/report-summary.js";
import {
  escapeAttribute,
  escapeHtml,
  stringTargets
} from "../shared/strings.js";
import { metadataTable, reportStyles, summaryTable } from "./html-fragments.js";

export function renderAxeAuditHtml(report: AxeAuditReport): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(report.auditId)} axe report</title>`,
    reportStyles(),
    "</head>",
    "<body>",
    "<main>",
    `<h1>${escapeHtml(report.auditId)} axe report</h1>`,
    metadataTable([
      ["Created", report.createdAt],
      ["URL", report.url],
      ["Strict mode", String(report.strict)],
      ["WCAG tags", report.wcagTags.join(", ")],
      ["Metadata", JSON.stringify(report.metadata, null, 2)]
    ]),
    summaryTable(report.summary),
    renderAuditScan("page-state", "Page State", report.scans.pageState),
    renderAuditScan("matched-surface", "Matched Surface", report.scans.matchedSurface),
    "</main>",
    "</body>",
    "</html>"
  ].join("\n");
}

function renderAuditScan(
  scanId: AxeAuditScanId,
  label: string,
  results: AxeResults
): string {
  return [
    `<section id="scan-${escapeAttribute(scanId)}">`,
    `<h2>${escapeHtml(label)}</h2>`,
    summaryTable(summarizeResults(results)),
    "<h3>Violations</h3>",
    renderRuleResults(scanId, "violation", results.violations),
    "<h3>Incomplete</h3>",
    renderRuleResults(scanId, "incomplete", results.incomplete),
    "</section>"
  ].join("\n");
}

function renderRuleResults(
  scanId: AxeAuditScanId,
  resultType: AxeRuleResultType,
  results: AxeRuleResult[]
): string {
  if (results.length === 0) return "<p>None.</p>";
  return results.map((result) => [
    '<article class="finding">',
    `<h4>${escapeHtml(result.id)}: ${escapeHtml(result.help)}</h4>`,
    `<p><strong>Impact:</strong> ${escapeHtml(result.impact ?? "unknown")}</p>`,
    `<p><a href="${escapeAttribute(result.helpUrl)}">${escapeHtml(result.helpUrl)}</a></p>`,
    `<p>${escapeHtml(result.description)}</p>`,
    result.nodes.map((node, nodeIndex) => renderAxeNode(scanId, resultType, result.id, node, nodeIndex)).join("\n"),
    "</article>"
  ].join("\n")).join("\n");
}

function renderAxeNode(
  scanId: AxeAuditScanId,
  resultType: AxeRuleResultType,
  ruleId: string,
  node: AxeNode,
  nodeIndex: number
): string {
  return [
    `<details id="${escapeAttribute(axeNodeHtmlId(scanId, resultType, ruleId, nodeIndex))}">`,
    `<summary>${escapeHtml(stringTargets(node).join(", "))}</summary>`,
    "<h5>HTML</h5>",
    `<pre>${escapeHtml(node.html)}</pre>`,
    "<h5>Failure Summary</h5>",
    `<pre>${escapeHtml(node.failureSummary ?? "")}</pre>`,
    "</details>"
  ].join("\n");
}
