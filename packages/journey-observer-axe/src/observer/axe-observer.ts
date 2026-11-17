import { immutableSnapshot, type JourneyObserverOutput, type JourneyMeasurement } from "@openuji/journey-core";
import { observerName, wcag22Tags } from "../constants.js";
import type { AxeObserver, AxeObserverOptions } from "../types.js";
import { runAxeAudit } from "../audit/run-axe-audit.js";
import { buildAxeObservedPathReport, strictAxeFailureReports } from "../reporting/observed-path-report.js";
import { axeFailureMessage } from "../audit/strict-mode.js";
import { collectAxeEvidence } from "./collect-evidence.js";
import { AxeEvidenceJournal } from "./evidence-journal.js";

export function axeObserver(options: AxeObserverOptions): AxeObserver {
  const config = Object.freeze({ ...options, excludedPhaseIds: Object.freeze([...(options.excludedPhaseIds ?? [])]) });
  const journal = new AxeEvidenceJournal();
  return {
    name: observerName,
    get evidence() { return journal.snapshot(); },
    onExecutionStarted({ execution }) { journal.append({ kind: "execution-started", execution }); },
    async observeOperation(observation) {
      const evidence = await collectAxeEvidence(observation, config, config.auditRunner ?? runAxeAudit);
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
      return immutableSnapshot({ id: config.reportId, kind: "axe", measurements, evidence: { journal: evidence, pathReport }, errors: strictAxeFailureReports(evidence, result.runId).map((report) => ({ name: "AxeStrictError", message: axeFailureMessage(report) })) });
    }
  };
}
