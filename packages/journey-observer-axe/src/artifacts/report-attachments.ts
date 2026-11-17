import type { ArtifactScope, JourneyArtifactStore } from "@openuji/journey-plugin";

import type {
  AxeAccessibilitySummaryReport,
  AxeAuditReport,
  AxePathAuditReport
} from "../types.js";
import {
  accessibilitySummaryJsonFileName,
  auditHtmlFileName,
  auditJsonFileName,
  pathAuditHtmlFileName,
  pathAuditJsonFileName
} from "./report-file-names.js";
import { renderAxeAuditHtml } from "../html/axe-audit-html.js";
import { renderAxePathAuditHtml } from "../html/path-audit-html.js";

/** One audit belongs to one operation of one execution. */
export async function attachAxeAuditReport(artifacts: JourneyArtifactStore, report: AxeAuditReport, scope: ArtifactScope): Promise<void> {
  await artifacts.write({ name: auditJsonFileName(report.auditId), data: JSON.stringify(report, null, 2), contentType: "application/json", scope });
  await artifacts.write({ name: auditHtmlFileName(report.auditId), data: renderAxeAuditHtml(report), contentType: "text/html", scope });
}

/** The path report covers every execution of the test. */
export async function attachAxePathAuditReport(artifacts: JourneyArtifactStore, report: AxePathAuditReport): Promise<void> {
  await artifacts.write({ name: pathAuditJsonFileName(report.reportId), data: JSON.stringify(report, null, 2), contentType: "application/json" });
  await artifacts.write({ name: pathAuditHtmlFileName(report.reportId), data: renderAxePathAuditHtml(report), contentType: "text/html" });
}

export async function attachAxeAccessibilitySummaryReport(artifacts: JourneyArtifactStore, report: AxeAccessibilitySummaryReport): Promise<void> {
  await artifacts.write({ name: accessibilitySummaryJsonFileName(report.source.reportId), data: JSON.stringify(report, null, 2), contentType: "application/json" });
}
