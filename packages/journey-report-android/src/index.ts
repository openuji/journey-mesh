/**
 * Report interpreter for the Android accessibility observer: turns the recorded hierarchy journal into
 * an evidence report and journey-map node metrics. Reads the run record only; no device runtime.
 */
import { immutableSnapshot, type Immutable } from "@openuji/journey-core";
import { defineInterpreter, type NodeSummary } from "@openuji/journey-reporter/interpreter";
import { noOptions } from "@openuji/journey-plugin";
import type { RunResult } from "@openuji/journey-runner";
import {
  androidAccessibilityKind, assessAndroidOperations, isAndroidAccessibilityOutput,
  type AndroidAccessibilityEvidence, type AndroidOperationAssessment
} from "@openuji/journey-observer-android-accessibility/evidence";

export const androidReportFormat = "journey-mesh/android-accessibility";
export const androidReportName = "android-accessibility.json";

/** Hrefs in `observation` (hierarchy XML, screenshots) are relative to the run directory. */
export type AndroidAccessibilityReport = Immutable<{
  format: typeof androidReportFormat;
  reportId: string; createdAt: string; runId: string; planId: string;
  strict: boolean;
  limits: readonly string[];
  summary: { executionCount: number; notApplicableProfileCount: number; checked: number; skipped: number; notApplicable: number; errors: number; findings: number; unassessed: number };
  items: readonly AndroidOperationAssessment[];
}>;

export const androidReportLimits = Object.freeze([
  "Hierarchy heuristics only; TalkBack behavior and WCAG conformance are not established.",
  "Labels use captured text and descriptions in non-actionable descendant groups.",
  "Bounds may be clipped by the viewport or ancestor containers and may omit expanded hit areas; small reported sizes require manual review. Missing attributes or density remain unassessed."
]);

export function buildAndroidAccessibilityReport(input: Readonly<{
  reportId: string; createdAt: string; result: RunResult; evidence: readonly AndroidAccessibilityEvidence[]; strict: boolean;
}>): AndroidAccessibilityReport {
  const items = assessAndroidOperations(input.evidence, input.result);
  const checks = items.flatMap((item) => item.checks);
  return immutableSnapshot({
    format: androidReportFormat, reportId: input.reportId, createdAt: input.createdAt, runId: input.result.runId, planId: input.result.plan.id,
    strict: input.strict, limits: androidReportLimits,
    summary: {
      executionCount: input.result.executions.length,
      notApplicableProfileCount: input.result.assessments.filter((assessment) => assessment.kind === "not-applicable").length,
      checked: items.filter((item) => item.status === "checked").length,
      skipped: items.filter((item) => item.status === "skipped").length,
      notApplicable: items.filter((item) => item.status === "not-applicable").length,
      errors: items.filter((item) => item.status === "error").length,
      findings: checks.filter((check) => check.status === "finding").length,
      unassessed: checks.filter((check) => check.status === "unassessed").length
    },
    items
  });
}

/** Journey-map node metrics: hierarchy findings and passed checks, `skipped` when collection did not complete. */
export function androidNodeSummaries(report: AndroidAccessibilityReport): readonly NodeSummary[] {
  return immutableSnapshot(report.items.flatMap((item): NodeSummary[] => {
    const node = { executionId: item.executionId, operationId: item.operationId };
    if (item.status === "checked") return [{ ...node, metrics: { kind: "native", findings: item.checks.filter((check) => check.status === "finding").length, passes: item.checks.filter((check) => check.status === "passed").length } }];
    if (item.status === "skipped" || item.status === "error") return [{ ...node, metrics: { kind: "skipped", ...(item.reason ? { reason: item.reason } : {}) } }];
    return [];
  }));
}

export const journeyMeshInterpreter = defineInterpreter({
  kind: androidAccessibilityKind,
  parse: (options) => noOptions(options),
  interpret({ test, output }) {
    if (!isAndroidAccessibilityOutput(output)) throw new Error(`Observer ${output.id} has no recorded Android journal`);
    const { reportId, createdAt, strict, journal } = output.evidence;
    const report = buildAndroidAccessibilityReport({ reportId, createdAt, strict, result: test.result, evidence: journal });
    return { nodes: androidNodeSummaries(report), data: [{ name: androidReportName, format: androidReportFormat, label: "Android accessibility report", value: report }] };
  }
});
