import { immutableSnapshot, type JourneyObserverOutput, type JourneyMeasurement } from "@openuji/journey-core";
import { observerName, wcag22Tags } from "../constants.js";
import type { AxeObserver, AxeObserverOptions } from "../types.js";
import { runAxeAudit } from "../audit/run-axe-audit.js";
import { axeNodeSummaries, buildAxeObservedPathReport, strictAxeFailureReports } from "../reporting/observed-path-report.js";
import { axeFailureMessage } from "../audit/strict-mode.js";
import { collectAxeEvidence } from "./collect-evidence.js";
import { AxeEvidenceJournal } from "./evidence-journal.js";
import { writeJsonDocument } from "@openuji/journey-plugin";
import { auditJsonFileName } from "../artifacts/report-file-names.js";
import { linkedAxeJournal } from "../output.js";

export function axeObserver(options: AxeObserverOptions): AxeObserver {
  const config = Object.freeze({ ...options, excludedPhaseIds: Object.freeze([...(options.excludedPhaseIds ?? [])]) });
  const journal = new AxeEvidenceJournal();
  return {
    name: observerName,
    get evidence() { return journal.snapshot(); },
    onExecutionStarted({ execution }) { journal.append({ kind: "execution-started", execution }); },
    async observeOperation(observation) {
      let evidence = await collectAxeEvidence(observation, config, config.auditRunner ?? runAxeAudit);
      if ("audit" in evidence && evidence.audit.kind === "completed") {
        const { runId, executionId, profileId, operation } = evidence;
        const artifact = await writeJsonDocument(config.artifacts, { name: auditJsonFileName(evidence.audit.report.auditId), value: evidence.audit.report,
          scope: { runId, executionId, profileId, operationId: operation.id } });
        evidence = { ...evidence, audit: { ...evidence.audit, document: { href: artifact.href } } };
      }
      journal.append({ kind: "operation-observed", evidence });
      if ("audit" in evidence && evidence.audit.kind === "failed") throw Object.assign(new Error(evidence.audit.error.message), evidence.audit.error);
    },
    output(result): JourneyObserverOutput {
      const evidence = journal.snapshot();
      const pathReport = buildAxeObservedPathReport({ reportId: config.reportId, createdAt: (config.now ?? (() => new Date().toISOString()))(), result, evidence, wcagTags: config.tags ?? wcag22Tags, metadata: config.metadata });
      const measurements: JourneyMeasurement[] = [];
      for (const execution of result.evidence.executions) {
        const reports = evidence.flatMap((fact) => fact.kind === "operation-observed" && fact.evidence.runId === result.runId && fact.evidence.executionId === execution.executionId && "audit" in fact.evidence && fact.evidence.audit.kind === "completed" ? [fact.evidence.audit.report] : []);
        const complete = result.executions.find((item) => item.executionId === execution.executionId)?.outcome.kind === "passed";
        for (const scan of ["pageState", "matchedSurface"] as const) for (const category of ["violations", "incomplete"] as const) {
          measurements.push({ id: `axe/${scan}/${category}`, label: `${scan === "pageState" ? "Page" : "Scoped"} axe ${category} across scans`, method: `axe-rule-results/${scan}/${(config.tags ?? wcag22Tags).join(",")}`, unit: "rule-result", aggregation: "sum-across-scans", scope: { runId: result.runId, executionId: execution.executionId, profileId: execution.profileId, operationIds: execution.operations.map((op) => op.operationId) }, status: !reports.length ? "unavailable" : complete ? "available" : "partial", value: reports.length ? reports.reduce((sum, report) => sum + report.scans[scan][category].length, 0) : null, ...(!reports.length ? { reason: "No completed axe scans." } : !complete ? { reason: "Execution ended before all scans completed." } : {}) });
        }
      }
      return immutableSnapshot({ id: config.reportId, kind: "axe", measurements, nodes: axeNodeSummaries(pathReport), evidence: { journal: linkedAxeJournal(evidence), pathReport }, errors: strictAxeFailureReports(evidence, result.runId).map((report) => ({ name: "AxeStrictError", message: axeFailureMessage(report) })) });
    }
  };
}
