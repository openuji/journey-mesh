/**
 * Report interpreter for the iOS accessibility observer: turns the recorded hierarchy journal into
 * an evidence report and journey-map node metrics. Reads the run record only; no device runtime.
 */
import { immutableSnapshot, type Immutable } from "@openuji/journey-core";
import { defineInterpreter, type NodeSummary } from "@openuji/journey-reporter/interpreter";
import { noOptions } from "@openuji/journey-plugin";
import type { RunResult } from "@openuji/journey-runner";
import {
  assessIosOperations,
  iosAccessibilityKind,
  isIosAccessibilityOutput,
  type IosAccessibilityEvidence,
  type IosOperationAssessment
} from "@openuji/journey-observer-ios-accessibility/evidence";

export const iosReportFormat = "journey-mesh/ios-accessibility";
export const iosReportName = "ios-accessibility.json";

/** Hrefs in `observation` (hierarchy XML, screenshots) are relative to the run directory. */
export type IosAccessibilityReport = Immutable<{
  format: typeof iosReportFormat;
  reportId: string;
  createdAt: string;
  runId: string;
  planId: string;
  strict: boolean;
  limits: readonly string[];
  summary: {
    executionCount: number;
    notApplicableProfileCount: number;
    checked: number;
    skipped: number;
    notApplicable: number;
    errors: number;
    findings: number;
    unassessed: number;
  };
  items: readonly IosOperationAssessment[];
}>;

export const iosReportLimits = Object.freeze([
  "Hierarchy heuristics only; VoiceOver behavior and WCAG conformance are not established.",
  "Labels use captured accessibility labels, identifiers, and values in non-actionable descendant groups.",
  "Bounds in UIKit points may be clipped by the viewport or ancestor containers and may omit expanded hit areas; targets below 44 × 44 pt require manual review."
]);

export function buildIosAccessibilityReport(
  input: Readonly<{
    reportId: string;
    createdAt: string;
    result: RunResult;
    evidence: readonly IosAccessibilityEvidence[];
    strict: boolean;
  }>
): IosAccessibilityReport {
  const items = assessIosOperations(input.evidence, input.result);
  const checks = items.flatMap((item) => item.checks);
  return immutableSnapshot({
    format: iosReportFormat,
    reportId: input.reportId,
    createdAt: input.createdAt,
    runId: input.result.runId,
    planId: input.result.plan.id,
    strict: input.strict,
    limits: iosReportLimits,
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
export function iosNodeSummaries(report: IosAccessibilityReport): readonly NodeSummary[] {
  return immutableSnapshot(
    report.items.flatMap((item): NodeSummary[] => {
      const node = { executionId: item.executionId, operationId: item.operationId };
      if (item.status === "checked") {
        return [
          {
            ...node,
            metrics: {
              kind: "native",
              findings: item.checks.filter((check) => check.status === "finding").length,
              passes: item.checks.filter((check) => check.status === "passed").length
            }
          }
        ];
      }
      if (item.status === "skipped" || item.status === "error") {
        return [{ ...node, metrics: { kind: "skipped", ...(item.reason ? { reason: item.reason } : {}) } }];
      }
      return [];
    })
  );
}

export const journeyMeshInterpreter = defineInterpreter({
  kind: iosAccessibilityKind,
  parse: (options) => noOptions(options),
  interpret({ test, output }) {
    if (!isIosAccessibilityOutput(output)) throw new Error(`Observer ${output.id} has no recorded iOS journal`);
    const { reportId, createdAt, strict, journal } = output.evidence;
    const report = buildIosAccessibilityReport({ reportId, createdAt, strict, result: test.result, evidence: journal });
    return {
      nodes: iosNodeSummaries(report),
      data: [{ name: iosReportName, format: iosReportFormat, label: "iOS accessibility report", value: report }]
    };
  }
});
