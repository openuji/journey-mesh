import type {
  AxeAuditScanSummaries,
  AxeAuditSummary,
  AxePathAuditItem,
  AxePathAuditSummary,
  AxeResults
} from "../types.js";

export function summarizePathItems(items: AxePathAuditItem[]): AxePathAuditSummary {
  return items.reduce(
    (summary, item) => ({
      items: summary.items + 1,
      audited: summary.audited + (item.status === "audited" ? 1 : 0),
      skipped: summary.skipped + (item.status === "skipped" ? 1 : 0),
      notApplicable: summary.notApplicable + (item.status === "not-applicable" ? 1 : 0),
      violations: summary.violations + (item.summary?.violations ?? 0),
      incomplete: summary.incomplete + (item.summary?.incomplete ?? 0),
      passes: summary.passes + (item.summary?.passes ?? 0),
      inapplicable: summary.inapplicable + (item.summary?.inapplicable ?? 0),
      scanSummaries: addAxeScanSummaries(summary.scanSummaries, item.scanSummaries)
    }),
    {
      items: 0,
      audited: 0,
      skipped: 0,
      notApplicable: 0,
      violations: 0,
      incomplete: 0,
      passes: 0,
      inapplicable: 0,
      scanSummaries: emptyScanSummaries()
    }
  );
}

export function summarizeResults(results: AxeResults): AxeAuditSummary {
  return {
    violations: results.violations.length,
    incomplete: results.incomplete.length,
    passes: results.passes.length,
    inapplicable: results.inapplicable.length
  };
}

export function addAxeScanSummaries(
  left: AxeAuditScanSummaries,
  right: AxeAuditScanSummaries | undefined
): AxeAuditScanSummaries {
  if (!right) return left;
  return {
    "page-state": addAxeSummaries(left["page-state"], right["page-state"]),
    "matched-surface": addAxeSummaries(left["matched-surface"], right["matched-surface"])
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

export function emptyScanSummaries(): AxeAuditScanSummaries {
  return {
    "page-state": emptyAxeSummary(),
    "matched-surface": emptyAxeSummary()
  };
}

export function emptyAxeSummary(): AxeAuditSummary {
  return {
    violations: 0,
    incomplete: 0,
    passes: 0,
    inapplicable: 0
  };
}
