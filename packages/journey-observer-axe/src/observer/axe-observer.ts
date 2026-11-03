import { observerName, wcag22Tags } from "../constants.js";
import type { AxeObserver, AxeObserverOptions, AxePathAuditReport, AxeAccessibilitySummaryReport } from "../types.js";
import { attachAxeAccessibilitySummaryReport, attachAxePathAuditReport, testResultDirectoryName } from "../artifacts/report-attachments.js";
import { axeFailureMessage } from "../audit/strict-mode.js";
import { runAxeAudit } from "../audit/run-axe-audit.js";
import { buildAxeAccessibilitySummaryReport } from "../reporting/accessibility-summary-report.js";
import { buildAxeObservedPathReport, strictAxeFailureReports } from "../reporting/observed-path-report.js";
import { collectAxeEvidence } from "./collect-evidence.js";
import { AxeEvidenceJournal } from "./evidence-journal.js";

type PublishedReports = Readonly<{
  pathReport: AxePathAuditReport;
  pathReportPath: string;
  accessibilitySummary: AxeAccessibilitySummaryReport;
  accessibilitySummaryPath: string;
}>;

export function axeObserver(options: AxeObserverOptions): AxeObserver {
  const journal = new AxeEvidenceJournal();
  const auditRunner = options.auditRunner ?? runAxeAudit;
  // The artifact boundary publishes one completed bundle, never provisional path items.
  let published: PublishedReports | undefined;

  return {
    name: observerName,
    version: "0.1.0",
    get evidence() { return journal.snapshot(); },
    get latestPathReport() { return published?.pathReport; },
    get latestPathReportPath() { return published?.pathReportPath; },
    get latestAccessibilitySummaryReport() { return published?.accessibilitySummary; },
    get latestAccessibilitySummaryReportPath() { return published?.accessibilitySummaryPath; },

    onExecutionStarted({ execution }) {
      journal.append({ kind: "execution-started", execution });
    },

    async observeOperation(observation) {
      const evidence = await collectAxeEvidence(observation, options, auditRunner);
      journal.append({ kind: "operation-observed", evidence });
      if ("audit" in evidence && evidence.audit.kind === "failed") {
        throw Object.assign(new Error(evidence.audit.error.message), evidence.audit.error);
      }
    },

    async report({ result }) {
      const evidence = journal.snapshot();
      const pathReport = buildAxeObservedPathReport({
        reportId: options.reportId,
        createdAt: new Date().toISOString(),
        result,
        evidence,
        wcagTags: options.tags ?? wcag22Tags,
        metadata: options.metadata
      });
      const accessibilitySummary = buildAxeAccessibilitySummaryReport({
        pathReport,
        generatedAt: pathReport.createdAt,
        delivery: options.accessibilitySummary?.delivery,
        artifactBaseHref: options.accessibilitySummary?.artifactBaseHref,
        testResultDirectoryName: testResultDirectoryName(options.testInfo)
      });
      const pathReportPath = await attachAxePathAuditReport(options.testInfo, pathReport);
      const accessibilitySummaryPath = await attachAxeAccessibilitySummaryReport(options.testInfo, accessibilitySummary);
      published = Object.freeze({ pathReport, pathReportPath, accessibilitySummary, accessibilitySummaryPath });

      const failures = strictAxeFailureReports(evidence, result.runId);
      if (failures.length > 0) throw new Error(failures.map(axeFailureMessage).join("\n"));
    }
  };
}
