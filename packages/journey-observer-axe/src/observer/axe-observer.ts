import { immutableSnapshot, type JourneyMeasurement } from "@openuji/journey-core";
import { axeAuditFormat, axeObserverKind, observerName, wcag22Tags } from "../constants.js";
import type { AxeObserver, AxeObserverOptions } from "../types.js";
import { runAxeAudit } from "../audit/run-axe-audit.js";
import { axeFailureMessage, strictAxeFailureReports } from "../audit/strict-mode.js";
import { collectAxeEvidence } from "./collect-evidence.js";
import { AxeEvidenceJournal } from "./evidence-journal.js";
import { auditJsonFileName } from "../artifacts/file-names.js";
import { linkedAxeJournal, type AxeObserverOutput } from "../output.js";

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
        const artifact = await config.artifacts.write({ name: auditJsonFileName(evidence.audit.report.auditId), data: JSON.stringify(evidence.audit.report),
          contentType: "application/json", format: axeAuditFormat, scope: { runId, executionId, profileId, operationId: operation.id } });
        evidence = { ...evidence, audit: { ...evidence.audit, document: { href: artifact.href } } };
      }
      journal.append({ kind: "operation-observed", evidence });
      if ("audit" in evidence && evidence.audit.kind === "failed") throw Object.assign(new Error(evidence.audit.error.message), evidence.audit.error);
    },
    output(result): AxeObserverOutput {
      const evidence = journal.snapshot();
      const measurements: JourneyMeasurement[] = [];
      for (const execution of result.evidence.executions) {
        const reports = evidence.flatMap((fact) => fact.kind === "operation-observed" && fact.evidence.runId === result.runId && fact.evidence.executionId === execution.executionId && "audit" in fact.evidence && fact.evidence.audit.kind === "completed" ? [fact.evidence.audit.report] : []);
        const complete = result.executions.find((item) => item.executionId === execution.executionId)?.outcome.kind === "passed";
        for (const scan of ["pageState", "matchedSurface"] as const) for (const category of ["violations", "incomplete"] as const) {
          measurements.push({ id: `axe/${scan}/${category}`, label: `${scan === "pageState" ? "Page" : "Scoped"} axe ${category} across scans`, method: `axe-rule-results/${scan}/${(config.tags ?? wcag22Tags).join(",")}`, unit: "rule-result", aggregation: "sum-across-scans", scope: { runId: result.runId, executionId: execution.executionId, profileId: execution.profileId, operationIds: execution.operations.map((op) => op.operationId) }, status: !reports.length ? "unavailable" : complete ? "available" : "partial", value: reports.length ? reports.reduce((sum, report) => sum + report.scans[scan][category].length, 0) : null, ...(!reports.length ? { reason: "No completed axe scans." } : !complete ? { reason: "Execution ended before all scans completed." } : {}) });
        }
      }
      const recorded = { reportId: config.reportId, createdAt: (config.now ?? (() => new Date().toISOString()))(), wcagTags: [...(config.tags ?? wcag22Tags)],
        ...(config.metadata ? { metadata: config.metadata } : {}), journal: linkedAxeJournal(evidence) };
      return immutableSnapshot({ id: config.reportId, kind: axeObserverKind, measurements, evidence: recorded,
        errors: strictAxeFailureReports(evidence, result.runId).map((report) => ({ name: "AxeStrictError", message: axeFailureMessage(report) })) });
    }
  };
}
