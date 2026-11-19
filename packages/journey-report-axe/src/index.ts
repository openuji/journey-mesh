/**
 * Report interpreter for the axe observer: turns recorded axe evidence into a path report,
 * a per-state summary, and journey-map node metrics. Reads the run record only; no browser runtime.
 */
import { immutableSnapshot } from "@openuji/journey-core";
import { defineInterpreter, type NodeSummary } from "@openuji/journey-reporter/interpreter";
import { axeObserverKind, isAxeOutput, type AxeAuditReport, type AxeEvidence, type LinkedAxeFact } from "@openuji/journey-observer-axe/evidence";
import { noOptions } from "@openuji/journey-plugin";
import { buildAxeAccessibilitySummaryReport } from "./accessibility-summary.js";
import { buildAxeObservedPathReport } from "./path-report.js";
import { accessibilitySummaryFormat, axePathFormat, type AxePathAuditReport } from "./types.js";

export * from "./types.js";
export { buildAxeObservedPathReport, buildAxePathAuditReport, buildAxePathItems, summarizePathItems } from "./path-report.js";
export { buildAxeAccessibilitySummaryReport, profileIdForItem } from "./accessibility-summary.js";

export const pathReportName = "axe-path.json";
export const summaryReportName = "accessibility-summary.json";

/** Journey-map node metrics: page and surface counts for audited items, `skipped` when an audit was expected but missing. */
export function axeNodeSummaries(report: AxePathAuditReport): readonly NodeSummary[] {
  return immutableSnapshot(report.items.flatMap((item): NodeSummary[] => {
    const executionId = item.metadata.executionId;
    const operationId = item.metadata.operationId;
    if (typeof executionId !== "string" || typeof operationId !== "string" || item.status === "not-applicable") return [];
    if (item.status === "skipped") return [{ executionId, operationId, metrics: { kind: "skipped", ...(item.reason ? { reason: item.reason } : {}) } }];
    return [{ executionId, operationId, metrics: { kind: "axe", ...(item.scanSummaries ? { pageState: item.scanSummaries["page-state"], matchedSurface: item.scanSummaries["matched-surface"] } : {}) } }];
  }));
}

/** Load the audit documents a recorded journal links to. */
async function hydrate(journal: readonly LinkedAxeFact[], readJson: <T>(href: string) => Promise<T>): Promise<AxeEvidence[]> {
  const facts: AxeEvidence[] = [];
  for (const fact of journal) {
    if (fact.kind === "execution-started" || !("audit" in fact.evidence) || fact.evidence.audit.kind !== "completed") { facts.push(fact as AxeEvidence); continue; }
    const document = fact.evidence.audit.document;
    const report = await readJson<AxeAuditReport>(document.href);
    facts.push({ kind: "operation-observed", evidence: { ...fact.evidence, audit: { kind: "completed", report, document } } } as AxeEvidence);
  }
  return facts;
}

export const journeyMeshInterpreter = defineInterpreter({
  kind: axeObserverKind,
  parse: (options) => noOptions(options),
  async interpret({ test, output, readJson }) {
    if (!isAxeOutput(output)) throw new Error(`Observer ${output.id} has no recorded axe journal`);
    const { reportId, createdAt, wcagTags, metadata, journal } = output.evidence;
    const pathReport = buildAxeObservedPathReport({ reportId, createdAt, result: test.result, evidence: await hydrate(journal, readJson), wcagTags, ...(metadata ? { metadata } : {}) });
    return {
      nodes: axeNodeSummaries(pathReport),
      data: [
        { name: pathReportName, format: axePathFormat, label: "Browser accessibility report (axe)", value: pathReport },
        { name: summaryReportName, format: accessibilitySummaryFormat, value: buildAxeAccessibilitySummaryReport({ pathReport, aggregateJsonHref: pathReportName }) }
      ]
    };
  }
});
