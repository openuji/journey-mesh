import { runReader } from "@openuji/journey-run-record/node";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { JourneyView } from "@openuji/journey-run-record";
import { jsonReader, loadReportModel, type LoadedReport } from "./model/load.js";
import type { ComparisonSubject, DataRef, ReportModel, TestModel } from "./model/types.js";

export type ExportedTest = Omit<TestModel, "views" | "data"> & Readonly<{
  views: Readonly<Record<string, JourneyView>>;
  data: readonly (DataRef & Readonly<{ value?: unknown }>)[];
}>;
export type ExportedReport = Omit<ReportModel, "tests" | "comparison"> & Readonly<{
  tests: readonly ExportedTest[];
  comparison?: Omit<NonNullable<ReportModel["comparison"]>, "subjects"> & Readonly<{
    subjects: Readonly<Record<"baseline" | "candidate", ComparisonSubject & Readonly<{ report: ExportedReport | null }>>>;
  }>;
}>;

async function inline(report: LoadedReport, data: boolean): Promise<ExportedReport> {
  const tests: ExportedTest[] = [];
  for (const summary of report.model.tests) {
    const test = await report.loadTest(summary.id);
    const views: Record<string, JourneyView> = {};
    for (const [key, view] of Object.entries(test.views)) views[key] = await report.readJson<JourneyView>(view.href);
    const items = [];
    for (const item of test.data) items.push(data ? { ...item, value: await report.readJson(item.href) } : item);
    tests.push({ ...test, views, data: items });
  }
  const { comparison, ...model } = report.model;
  if (!comparison) return { ...model, tests };
  const subjects = {} as Record<"baseline" | "candidate", ComparisonSubject & { report: ExportedReport | null }>;
  for (const side of ["baseline", "candidate"] as const) {
    const subject = await report.loadSubject(side);
    subjects[side] = { ...comparison.subjects[side], report: subject ? await inline(subject, data) : null };
  }
  return { ...model, tests, comparison: { ...comparison, subjects } };
}

/**
 * The whole report as one plain JSON value for template engines and other stacks: test models inlined,
 * model snapshots resolved, and with `data` also every interpreter output.
 */
export async function exportReport(path: string, options: Readonly<{ data?: boolean }> = {}): Promise<ExportedReport> {
  const directory = resolve(path);
  if (!(await stat(directory)).isDirectory()) throw new Error("Expected a run or comparison directory");
  return inline(await loadReportModel(jsonReader(runReader(directory))), options.data ?? false);
}
