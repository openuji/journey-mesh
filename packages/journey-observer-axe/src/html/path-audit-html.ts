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
import type { HtmlDocumentParts } from "@openuji/journey-plugin";
import { metadataTable, reportStyles, trustedHtml } from "./html-fragments.js";

export function renderAxePathAuditHtml(report: AxePathAuditReport): string {
  const parts = axePathHtmlParts(report);
  return parts.header + parts.sections.join("") + parts.footer;
}

export function axePathHtmlParts(report: AxePathAuditReport): HtmlDocumentParts {
  const header = ["<!doctype html>", '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(report.reportId)} axe path report</title>`, reportStyles(), "</head><body><main>",
    `<h1>${escapeHtml(report.reportId)} axe path report</h1>`,
    metadataTable([["Created", report.createdAt], ["Report format", report.format], ["WCAG tags", report.wcagTags.join(", ")],
      ["Metadata", JSON.stringify(report.metadata)]]), renderPathSummary(report.summary)].join("\n");
  const sections = groupPathItemsByProfile(report.items).flatMap(({ profileId, profileItems }) => [
    `<section class="profile-group" id="profile-${escapeAttribute(safeFileSegment(profileId))}"><h2>${escapeHtml(profileId)}</h2>${renderPathSummary(summarizePathItems(profileItems))}</section>`,
    ...profileItems.map(renderPathItem)
  ]);
  return { header, sections, footer: "</main></body></html>" };
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
    "</details>"
  ].join("\n");
}

function groupPathItemsByProfile(
  items: readonly AxePathAuditItem[]
): Array<{ profileId: string; profileItems: AxePathAuditItem[] }> {
  return items.reduce<Array<{ profileId: string; profileItems: AxePathAuditItem[] }>>((groups, item) => {
    const profileId = profileIdForItem(item);
    return groups.some((group) => group.profileId === profileId)
      ? groups.map((group) => group.profileId === profileId ? { ...group, profileItems: [...group.profileItems, item] } : group)
      : [...groups, { profileId, profileItems: [item] }];
  }, []);
}

function renderSourceScreenshot(item: AxePathAuditItem): string {
  if (!item.sourceScreenshotHref && !item.sourceScreenshotError) return "";
  return [
    "<section>",
    "<h4>Source Screenshot</h4>",
    item.sourceScreenshotHref
      ? `<p><a href="${escapeAttribute(item.sourceScreenshotHref)}">${escapeHtml(item.sourceScreenshotHref)}</a></p><img loading="lazy" src="${escapeAttribute(item.sourceScreenshotHref)}" alt="Source screenshot">`
      : "",
    item.sourceScreenshotError ? `<p>${escapeHtml(item.sourceScreenshotError)}</p>` : "",
    "</section>"
  ].join("\n");
}
