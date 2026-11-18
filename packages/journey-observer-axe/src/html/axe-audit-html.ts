import type {
  AxeAuditReport,
  AxeAuditScanId,
  AxeNode,
  AxeRuleResultType
} from "../types.js";
import type { Immutable } from "@openuji/journey-core";
import { axeNodeHtmlId } from "../artifacts/report-file-names.js";
import { summarizeResults } from "../reporting/report-summary.js";
import {
  escapeAttribute,
  escapeHtml,
  stringTargets
} from "../shared/strings.js";
import { metadataTable, reportStyles, summaryTable } from "./html-fragments.js";

import type { HtmlDocumentParts } from "@openuji/journey-plugin";

export function renderAxeAuditHtml(report: AxeAuditReport): string {
  const parts = axeAuditHtmlParts(report);
  return parts.header + parts.sections.join("") + parts.footer;
}

export function axeAuditHtmlParts(report: AxeAuditReport): HtmlDocumentParts {
  const header = ["<!doctype html>", '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(report.auditId)} axe report</title>`, reportStyles(), "</head><body><main>",
    `<h1>${escapeHtml(report.auditId)} axe report</h1>`,
    metadataTable([["Created", report.createdAt], ["URL", report.url], ["Strict mode", String(report.strict)],
      ["WCAG tags", report.wcagTags.join(", ")], ["Metadata", JSON.stringify(report.metadata)]]), summaryTable(report.summary)].join("\n");
  const sections: string[] = [];
  for (const [scanId, label, results] of [["page-state", "Page State", report.scans.pageState], ["matched-surface", "Matched Surface", report.scans.matchedSurface]] as const) {
    sections.push(`<section id="scan-${scanId}"><h2>${label}</h2>${summaryTable(summarizeResults(results))}</section>`);
    for (const [category, type] of [["violations", "violation"], ["incomplete", "incomplete"]] as const) {
      if (!results[category].length) sections.push(`<p>${label} ${category}: none.</p>`);
      for (const result of results[category]) {
        const heading = `<h3>${label} ${type}: ${escapeHtml(result.id)}: ${escapeHtml(result.help)}</h3><p>${escapeHtml(result.description)}</p><p><a href="${escapeAttribute(result.helpUrl)}">Rule documentation</a></p>`;
        if (!result.nodes.length) sections.push(`<article class="finding">${heading}</article>`);
        for (const [index, node] of result.nodes.entries()) sections.push(`<article class="finding">${heading}${renderAxeNode(scanId, type, result.id, node, index)}</article>`);
      }
    }
  }
  return { header, sections, footer: "</main></body></html>" };
}

function renderAxeNode(
  scanId: AxeAuditScanId,
  resultType: AxeRuleResultType,
  ruleId: string,
  node: Immutable<AxeNode>,
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
