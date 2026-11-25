/**
 * Report interpreter for the findings observer. It turns each failed operation into a finding, groups
 * it across profiles, and decides the marks a renderer draws. Reads the run record only.
 */
import { isFindingsOutput, findingsObserverKind } from "@openuji/journey-observer-findings/evidence";
import { noOptions } from "@openuji/journey-plugin";
import { defineInterpreter } from "@openuji/journey-reporter/interpreter";
import { buildFindingsReport } from "./build.js";
import { findingsReportFormat, findingsReportLabel, findingsReportName } from "./types.js";

export * from "./types.js";
export { buildFindingsReport, collapseKeys, describe, type BuildFindingsInput } from "./build.js";

export const journeyMeshInterpreter = defineInterpreter({
  kind: findingsObserverKind,
  parse: (options) => noOptions(options),
  interpret({ test, output, excludedPhaseIds }) {
    if (!isFindingsOutput(output)) throw new Error(`Observer ${output.id} has no recorded findings evidence`);
    const report = buildFindingsReport({ observerId: output.id, test, evidence: output.evidence, excludedPhaseIds });
    return { data: [{ name: findingsReportName, format: findingsReportFormat, label: findingsReportLabel, value: report }] };
  }
});
