/** Reads the findings of a run from its report model: report.json, each test model, then its findings data. */
import { findingsReportFormat, type FindingsReport } from "@openuji/journey-report-findings";
import type { ReportModel, TestModel } from "@openuji/journey-reporter/model";

/** Reads a file of the run directory; `href` is relative to it. */
export type RunFileReader = (href: string) => Promise<Uint8Array>;

export type LoadedFindings = Readonly<{ model: ReportModel; reports: readonly FindingsReport[] }>;

export async function loadFindings(read: RunFileReader): Promise<LoadedFindings> {
  const json = async <T>(href: string) => JSON.parse(new TextDecoder().decode(await read(href))) as T;
  const model = await json<ReportModel>("report/report.json");
  if (model.format !== "journey-mesh/report-model" || model.version !== 1) throw new Error("Expected report/report.json (journey-mesh/report-model, version 1)");
  const reports: FindingsReport[] = [];
  for (const entry of model.tests) {
    const test = await json<TestModel>(entry.href);
    for (const data of test.data.filter((item) => item.format === findingsReportFormat)) {
      const report = await json<FindingsReport>(data.href);
      if (report.format !== findingsReportFormat || report.version !== 1) throw new Error(`Expected ${data.href} to be ${findingsReportFormat}, version 1`);
      reports.push(report);
    }
  }
  return { model, reports };
}
