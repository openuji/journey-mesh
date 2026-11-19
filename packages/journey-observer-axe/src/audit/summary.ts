import type { AxeAuditScanSummaries, AxeAuditSummary, AxeResults } from "../types.js";
import type { Immutable } from "@openuji/journey-core";

/** Rule-result counts of one axe scan. */
export function summarizeResults(results: Immutable<AxeResults>): AxeAuditSummary {
  return {
    violations: results.violations.length,
    incomplete: results.incomplete.length,
    passes: results.passes.length,
    inapplicable: results.inapplicable.length
  };
}

export function addAxeSummaries(left: AxeAuditSummary, right: AxeAuditSummary): AxeAuditSummary {
  return {
    violations: left.violations + right.violations,
    incomplete: left.incomplete + right.incomplete,
    passes: left.passes + right.passes,
    inapplicable: left.inapplicable + right.inapplicable
  };
}

export function addAxeScanSummaries(left: AxeAuditScanSummaries, right: AxeAuditScanSummaries | undefined): AxeAuditScanSummaries {
  if (!right) return left;
  return {
    "page-state": addAxeSummaries(left["page-state"], right["page-state"]),
    "matched-surface": addAxeSummaries(left["matched-surface"], right["matched-surface"])
  };
}

export function emptyAxeSummary(): AxeAuditSummary {
  return { violations: 0, incomplete: 0, passes: 0, inapplicable: 0 };
}

export function emptyScanSummaries(): AxeAuditScanSummaries {
  return { "page-state": emptyAxeSummary(), "matched-surface": emptyAxeSummary() };
}
