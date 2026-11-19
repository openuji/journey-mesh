import type { AxePathAuditItem, AxePathAuditReport, AxePathAuditSummary } from "@openuji/journey-report-axe";
import type { LoadedReport } from "@openuji/journey-reporter/model";
import { dataHash, fileUrl, MetadataTable } from "../ui.js";
import { axeNodeAnchor } from "./AxeAuditReport.js";

const auditFormat = "journey-mesh/axe-audit";
const profileOf = (item: AxePathAuditItem) => (typeof item.metadata.profileId === "string" && item.metadata.profileId) || item.groupId?.split(":")[0] || "unprofiled";

function PathSummary({ summary }: { summary: AxePathAuditSummary }) {
  return <MetadataTable rows={[["Items", summary.items], ["Audited", summary.audited], ["Skipped", summary.skipped], ["Not applicable", summary.notApplicable],
    ["Violations", summary.violations], ["Incomplete", summary.incomplete], ["Passes", summary.passes], ["Inapplicable", summary.inapplicable]]} />;
}

function Item({ item, report }: { item: AxePathAuditItem; report: LoadedReport }) {
  const page = item.scanSummaries?.["page-state"];
  const surface = item.scanSummaries?.["matched-surface"];
  const audit = item.sourceJsonHref;
  const findings = [...(item.findings?.violations ?? []), ...(item.findings?.incomplete ?? [])];
  return <details className={`item ${item.status}`} id={item.itemId}>
    <summary><strong>{item.auditId ?? item.itemId}</strong> {item.status} · total V:{item.summary?.violations ?? 0} I:{item.summary?.incomplete ?? 0} · page V:{page?.violations ?? 0} · surface V:{surface?.violations ?? 0}</summary>
    <MetadataTable rows={[["Status", item.status], ["Reason", item.reason ?? ""], ["URL", item.url ?? ""], ["Strict", item.strict === undefined ? "" : String(item.strict)],
      ["Audit", audit ? <><a href={dataHash(report, audit, auditFormat, item.auditId)}>Open audit</a> · <a href={fileUrl(report, audit)} download>JSON</a></> : ""],
      ["Metadata", <pre>{JSON.stringify(item.metadata, null, 2)}</pre>]]} />
    {findings.length > 0 && <ul className="findings">{findings.flatMap((finding) => finding.nodes.map((node) => <li key={`${finding.scanId}-${finding.type}-${finding.ruleId}-${node.nodeIndex}`}>
      <strong>{finding.ruleId}</strong> ({finding.type}, {finding.scanId}) {node.target.join(", ")}
      {audit && <> · <a href={`${dataHash(report, audit, auditFormat, item.auditId)}&node=${encodeURIComponent(axeNodeAnchor(finding.scanId, finding.type, finding.ruleId, node.nodeIndex))}`}>Details</a></>}
    </li>))}</ul>}
    {item.sourceScreenshotHref && <img loading="lazy" src={fileUrl(report, item.sourceScreenshotHref)} alt={`Source screenshot of ${item.itemId}`} />}
    {item.sourceScreenshotError && <p>{item.sourceScreenshotError}</p>}
  </details>;
}

/** Every planned operation of a test, audited or with its reason (format `journey-mesh/axe-path`). */
export function AxePathReport({ value, report }: { value: unknown; report: LoadedReport }) {
  const path = value as AxePathAuditReport;
  const profiles = [...new Set(path.items.map(profileOf))];
  return <article className="provider-report axe-path">
    <h1>{path.reportId} axe path report</h1>
    <MetadataTable rows={[["Created", path.createdAt], ["WCAG tags", path.wcagTags.join(", ")], ["Metadata", <pre>{JSON.stringify(path.metadata, null, 2)}</pre>]]} />
    <h2>Summary</h2>
    <PathSummary summary={path.summary} />
    {profiles.map((profile) => <section key={profile} className="profile-group">
      <h2>{profile}</h2>
      {path.items.filter((item) => profileOf(item) === profile).map((item) => <Item key={item.itemId} item={item} report={report} />)}
    </section>)}
  </article>;
}
