import type { AxeAuditSummary } from "../types.js";
import { escapeHtml } from "../shared/strings.js";

type HtmlTableCell =
  | {
      kind: "text";
      value: string;
    }
  | {
      kind: "html";
      value: string;
    };

type HtmlTableCellInput = string | HtmlTableCell;

export function trustedHtml(value: string): HtmlTableCell {
  return { kind: "html", value };
}

export function metadataTable(rows: Array<[string, HtmlTableCellInput]>): string {
  return [
    "<table>",
    ...rows.map(([label, value]) =>
      `<tr><th>${escapeHtml(label)}</th><td>${renderTableCell(value)}</td></tr>`
    ),
    "</table>"
  ].join("\n");
}

export function summaryTable(summary: AxeAuditSummary): string {
  return metadataTable([
    ["Violations", String(summary.violations)],
    ["Incomplete", String(summary.incomplete)],
    ["Passes", String(summary.passes)],
    ["Inapplicable", String(summary.inapplicable)]
  ]);
}

export function reportStyles(): string {
  return [
    "<style>",
    "body{font-family:system-ui,sans-serif;margin:2rem;line-height:1.45;color:#17202a}",
    "main{max-width:1200px}",
    "section{margin-block:2rem}",
    "table{border-collapse:collapse;width:100%;margin-block:1rem}",
    "th,td{border:1px solid #d8dee4;padding:.5rem;text-align:left;vertical-align:top}",
    "th{background:#f6f8fa}",
    "pre{background:#f6f8fa;border-radius:4px;padding:.75rem;overflow:auto}",
    "img{display:block;max-width:min(100%,960px);height:auto;border:1px solid #d8dee4}",
    ".item{border:1px solid #d8dee4;border-radius:6px;padding:.75rem 1rem;margin-block:1rem}",
    ".item.skipped{border-color:#bf8700;background:#fff8c5}",
    ".item.not-applicable{background:#f6f8fa}",
    ".finding{border-left:4px solid #cf222e;padding-left:.75rem;margin-block:1rem}",
    "</style>"
  ].join("\n");
}

function renderTableCell(value: HtmlTableCellInput): string {
  if (typeof value === "string") {
    return escapeHtml(value);
  }
  return value.kind === "html" ? value.value : escapeHtml(value.value);
}
