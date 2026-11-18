import type { ArtifactScope, JourneyArtifactStore } from "@openuji/journey-plugin";
import { writeJsonDocument, writeHtmlPages } from "@openuji/journey-plugin";

import type {
  AxeAccessibilitySummaryReport,
  AxeAuditReport,
  AxePathAuditReport
} from "../types.js";
import {
  accessibilitySummaryJsonFileName,
  auditHtmlFileName,
  pathAuditHtmlFileName,
  pathAuditJsonFileName
} from "./report-file-names.js";
import { axeAuditHtmlParts } from "../html/axe-audit-html.js";
import { axePathHtmlParts } from "../html/path-audit-html.js";

/** One audit belongs to one operation of one execution. */
export async function attachAxeAuditHtml(artifacts: JourneyArtifactStore, report: AxeAuditReport, scope: ArtifactScope): Promise<void> {
  await writeHtmlPages(artifacts, { name: auditHtmlFileName(report.auditId), ...axeAuditHtmlParts(report), scope });
}

/** The path report covers every execution of the test. */
export async function attachAxePathAuditReport(artifacts: JourneyArtifactStore, report: AxePathAuditReport): Promise<void> {
  await writeJsonDocument(artifacts, { name: pathAuditJsonFileName(report.reportId), value: report });
  await writeHtmlPages(artifacts, { name: pathAuditHtmlFileName(report.reportId), ...axePathHtmlParts(report), label: "Browser accessibility report (axe)" });
}

export async function attachAxeAccessibilitySummaryReport(artifacts: JourneyArtifactStore, report: AxeAccessibilitySummaryReport): Promise<void> {
  await writeJsonDocument(artifacts, { name: accessibilitySummaryJsonFileName(report.source.reportId), value: report });
}
