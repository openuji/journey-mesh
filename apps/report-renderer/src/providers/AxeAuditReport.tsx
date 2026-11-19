import type { AxeAuditReport as Audit, AxeAuditScanId, AxeAuditSummary, AxeResults } from "@openuji/journey-observer-axe/evidence";
import { MetadataTable } from "../ui.js";

const segment = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-");
/** Anchor of one node of one rule result, linked from path reports. */
export const axeNodeAnchor = (scanId: AxeAuditScanId, resultType: "violation" | "incomplete", ruleId: string, nodeIndex: number) =>
  `scan-${segment(scanId)}-${segment(resultType)}-${segment(ruleId)}-node-${nodeIndex}`;

const targets = (target: readonly unknown[]) => target.map((item) => Array.isArray(item) ? item.join(" ") : String(item));
const summarize = (results: AxeResults | Audit["scans"]["pageState"]): AxeAuditSummary => ({
  violations: results.violations.length, incomplete: results.incomplete.length, passes: results.passes.length, inapplicable: results.inapplicable.length
});

export function SummaryTable({ summary }: { summary: AxeAuditSummary }) {
  return <MetadataTable rows={[["Violations", summary.violations], ["Incomplete", summary.incomplete], ["Passes", summary.passes], ["Inapplicable", summary.inapplicable]]} />;
}

/** One axe audit of one operation (raw evidence, format `journey-mesh/axe-audit`). */
export function AxeAuditReport({ value }: { value: unknown }) {
  const report = value as Audit;
  const scans = [["page-state", "Page state", report.scans.pageState], ["matched-surface", "Matched surface", report.scans.matchedSurface]] as const;
  return <article className="provider-report axe-audit">
    <h1>{report.auditId} axe audit</h1>
    <MetadataTable rows={[["Created", report.createdAt], ["URL", report.url], ["Strict mode", String(report.strict)],
      ["WCAG tags", report.wcagTags.join(", ")], ["Metadata", <pre>{JSON.stringify(report.metadata, null, 2)}</pre>]]} />
    <SummaryTable summary={report.summary} />
    {scans.map(([scanId, label, results]) => <section key={scanId} id={`scan-${scanId}`}>
      <h2>{label}</h2>
      <SummaryTable summary={summarize(results)} />
      {(["violation", "incomplete"] as const).map((type) => {
        const rules = type === "violation" ? results.violations : results.incomplete;
        if (!rules.length) return <p key={type}>{label} {type === "violation" ? "violations" : "incomplete"}: none.</p>;
        return rules.map((rule) => <article className="finding" key={`${type}-${rule.id}`}>
          <h3>{label} {type}: {rule.id}: {rule.help}</h3>
          <p>{rule.description}</p>
          <p><a href={rule.helpUrl} target="_blank" rel="noopener">Rule documentation</a></p>
          {rule.nodes.map((node, index) => <details key={index} id={axeNodeAnchor(scanId, type, rule.id, index)}>
            <summary>{targets(node.target as readonly unknown[]).join(", ")}</summary>
            <h4>HTML</h4><pre>{node.html}</pre>
            <h4>Failure summary</h4><pre>{node.failureSummary ?? ""}</pre>
          </details>)}
        </article>);
      })}
    </section>)}
  </article>;
}
