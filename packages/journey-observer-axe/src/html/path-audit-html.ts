import type {
  AxePathAuditItem,
  AxePathAuditReport,
  AxePathAuditSummary
} from "../types.js";
import { emptyAxeSummary, summarizePathItems } from "../reporting/report-summary.js";
import {
  escapeAttribute,
  escapeHtml,
  profileIdForItem,
  safeFileSegment
} from "../shared/strings.js";
import { metadataTable, reportStyles, trustedHtml } from "./html-fragments.js";

export function renderAxePathAuditHtml(
  report: AxePathAuditReport,
  options: { baseHref?: string } = {}
): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    options.baseHref ? `<base href="${escapeAttribute(options.baseHref)}">` : "",
    `<title>${escapeHtml(report.reportId)} axe path report</title>`,
    reportStyles(),
    "</head>",
    "<body>",
    "<main>",
    `<h1>${escapeHtml(report.reportId)} axe path report</h1>`,
    metadataTable([
      ["Created", report.createdAt],
      ["Schema version", report.schemaVersion],
      ["WCAG tags", report.wcagTags.join(", ")],
      ["Metadata", JSON.stringify(report.metadata, null, 2)]
    ]),
    renderPathSummary(report.summary),
    renderPathItemsByProfile(report.items),
    "</main>",
    "</body>",
    "</html>"
  ].join("\n");
}

function renderPathSummary(summary: AxePathAuditSummary): string {
  return [
    "<section>",
    "<h2>Summary</h2>",
    metadataTable([
      ["Items", String(summary.items)],
      ["Audited", String(summary.audited)],
      ["Skipped", String(summary.skipped)],
      ["Not applicable", String(summary.notApplicable)],
      ["Violations", String(summary.violations)],
      ["Incomplete", String(summary.incomplete)],
      ["Passes", String(summary.passes)],
      ["Inapplicable", String(summary.inapplicable)]
    ]),
    "</section>"
  ].join("\n");
}

function renderPathItem(item: AxePathAuditItem): string {
  const pageSummary = item.scanSummaries?.["page-state"] ?? emptyAxeSummary();
  const surfaceSummary = item.scanSummaries?.["matched-surface"] ?? emptyAxeSummary();
  const links = [
    item.sourceJsonHref ? `<a href="${escapeAttribute(item.sourceJsonHref)}">JSON</a>` : "",
    item.sourceHtmlHref ? `<a href="${escapeAttribute(item.sourceHtmlHref)}">HTML</a>` : ""
  ].filter(Boolean).join(" ");

  return [
    `<details class="item ${escapeAttribute(item.status)}" id="${escapeAttribute(item.itemId)}">`,
    `<summary><strong>${escapeHtml(item.auditId ?? item.itemId)}</strong> ${escapeHtml(item.status)} total V:${item.summary?.violations ?? 0} I:${item.summary?.incomplete ?? 0} page V:${pageSummary.violations} locator V:${surfaceSummary.violations}</summary>`,
    metadataTable([
      ["Status", item.status],
      ["Reason", item.reason ?? ""],
      ["URL", item.url ?? ""],
      ["Strict", item.strict === undefined ? "" : String(item.strict)],
      ["Reports", trustedHtml(links)],
      ["Metadata", JSON.stringify(item.metadata, null, 2)]
    ]),
    renderSourceScreenshot(item),
    renderPathFindings(item),
    "</details>"
  ].join("\n");
}

function renderPathItemsByProfile(items: AxePathAuditItem[]): string {
  const profiles = groupPathItemsByProfile(items);
  return [
    "<section>",
    "<h2>Path Items</h2>",
    ...profiles.map(({ profileId, profileItems }) => [
      `<section class="profile-group" id="profile-${escapeAttribute(safeFileSegment(profileId))}">`,
      `<h3>${escapeHtml(profileId)}</h3>`,
      renderPathSummary(summarizePathItems(profileItems)),
      profileItems.map(renderPathItem).join("\n"),
      "</section>"
    ].join("\n")),
    "</section>"
  ].join("\n");
}

function groupPathItemsByProfile(
  items: AxePathAuditItem[]
): Array<{ profileId: string; profileItems: AxePathAuditItem[] }> {
  const groups = new Map<string, AxePathAuditItem[]>();
  for (const item of items) {
    const profileId = profileIdForItem(item);
    const profileItems = groups.get(profileId) ?? [];
    profileItems.push(item);
    groups.set(profileId, profileItems);
  }

  return [...groups.entries()].map(([profileId, profileItems]) => ({ profileId, profileItems }));
}

function renderSourceScreenshot(item: AxePathAuditItem): string {
  if (!item.sourceScreenshotHref && !item.sourceScreenshotError) return "";
  return [
    "<section>",
    "<h4>Source Screenshot</h4>",
    item.sourceScreenshotHref
      ? `<p><a href="${escapeAttribute(item.sourceScreenshotHref)}">${escapeHtml(item.sourceScreenshotHref)}</a></p><img src="${escapeAttribute(item.sourceScreenshotHref)}" alt="Source screenshot">`
      : "",
    item.sourceScreenshotError ? `<p>${escapeHtml(item.sourceScreenshotError)}</p>` : "",
    "</section>"
  ].join("\n");
}

function renderPathFindings(item: AxePathAuditItem): string {
  if (!item.findings) return "";
  return [...item.findings.violations, ...item.findings.incomplete].map((finding) => [
    '<article class="finding">',
    `<h4>${escapeHtml(finding.scanId)} ${escapeHtml(finding.type)}: ${escapeHtml(finding.ruleId)}</h4>`,
    `<p>${escapeHtml(finding.help)}</p>`,
    finding.nodes.map((node) =>
      `<p><a href="${escapeAttribute(node.htmlHref)}">${escapeHtml(node.target.join(", "))}</a></p>`
    ).join("\n"),
    "</article>"
  ].join("\n")).join("\n");
}
