import type { TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

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

export async function attachAxeAuditReport(
  testInfo: TestInfo,
  report: AxeAuditReport
): Promise<void> {
  const jsonPath = testInfo.outputPath(auditJsonFileName(report.auditId));
  const htmlPath = testInfo.outputPath(auditHtmlFileName(report.auditId));

  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(htmlPath, renderAxeAuditHtml(report));

  await testInfo.attach(`axe-${report.auditId}.json`, {
    path: jsonPath,
    contentType: "application/json"
  });
  await testInfo.attach(`axe-${report.auditId}.html`, {
    path: htmlPath,
    contentType: "text/html"
  });
}

export async function attachAxePathAuditReport(
  testInfo: TestInfo,
  report: AxePathAuditReport
): Promise<string> {
  const jsonPath = testInfo.outputPath(pathAuditJsonFileName(report.reportId));
  const htmlPath = testInfo.outputPath(pathAuditHtmlFileName(report.reportId));
  const attachmentHtmlPath = testInfo.outputPath(
    "axe-path-attachments",
    pathAuditHtmlFileName(report.reportId)
  );

  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(htmlPath, renderAxePathAuditHtml(report));
  await mkdir(dirname(attachmentHtmlPath), { recursive: true });
  await writeFile(attachmentHtmlPath, renderAxePathAuditHtml(report, { baseHref: "../" }));

  await testInfo.attach(`axe-path-${report.reportId}.json`, {
    path: jsonPath,
    contentType: "application/json"
  });
  await testInfo.attach(`axe-path-${report.reportId}.html`, {
    path: attachmentHtmlPath,
    contentType: "text/html"
  });

  return htmlPath;
}

export async function attachAxeAccessibilitySummaryReport(
  testInfo: TestInfo,
  report: AxeAccessibilitySummaryReport
): Promise<string> {
  const jsonPath = testInfo.outputPath(accessibilitySummaryJsonFileName(report.source.reportId));

  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await testInfo.attach(`axe-accessibility-${report.source.reportId}.json`, {
    path: jsonPath,
    contentType: "application/json"
  });

  return jsonPath;
}

export function testResultDirectoryName(testInfo: TestInfo): string | undefined {
  return testInfo.outputDir ? basename(testInfo.outputDir) : undefined;
}
