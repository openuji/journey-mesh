import { defineReporterPlugin, noOptions, type JourneyReporter } from "@openuji/journey-plugin";
import { isAxeOutput } from "./output.js";
import { attachAxeAuditReport, attachAxePathAuditReport, attachAxeAccessibilitySummaryReport } from "./artifacts/report-attachments.js";
import { buildAxeAccessibilitySummaryReport } from "./reporting/accessibility-summary-report.js";

export function axeReporter(): JourneyReporter {
  return { name: "journey-mesh/axe", async report({ bundle, artifacts }) {
    if (bundle.kind !== "test") throw new Error("The axe reporter must be configured on a test");
    for (const output of bundle.outputs.filter(isAxeOutput)) {
      const { journal, pathReport } = output.evidence;
      for (const fact of journal) {
        if (fact.kind !== "operation-observed" || !("audit" in fact.evidence) || fact.evidence.audit.kind !== "completed") continue;
        const { runId, executionId, profileId, operation } = fact.evidence;
        await attachAxeAuditReport(artifacts, fact.evidence.audit.report, { runId, executionId, profileId, operationId: operation.id });
      }
      await attachAxePathAuditReport(artifacts, pathReport);
      await attachAxeAccessibilitySummaryReport(artifacts, buildAxeAccessibilitySummaryReport({ pathReport, generatedAt: pathReport.createdAt }));
    }
  } };
}
export const journeyMeshPlugin = defineReporterPlugin({ kind: "reporter", parse: noOptions, create: () => axeReporter() });
