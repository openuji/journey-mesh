import type { AxeEvidence } from "../observer/evidence.js";
import type { AxeAuditReport } from "../types.js";

export function shouldFailForAxeViolations(report: AxeAuditReport): boolean {
  return report.strict && report.summary.violations > 0;
}

export function axeFailureMessage(report: AxeAuditReport): string {
  return [
    `Axe found ${report.summary.violations} WCAG violation(s) for ${report.auditId}.`,
    "See the axe audit evidence for details."
  ].join(" ");
}

/** Strict mode derives from every completed scan of the run, including superseded observations. */
export function strictAxeFailureReports(evidence: readonly AxeEvidence[], runId: string): readonly AxeAuditReport[] {
  return Object.freeze(evidence.flatMap((fact) => {
    if (fact.kind !== "operation-observed" || fact.evidence.runId !== runId || !("audit" in fact.evidence)) return [];
    const audit = fact.evidence.audit;
    return audit.kind === "completed" && shouldFailForAxeViolations(audit.report) ? [audit.report] : [];
  }));
}

export function isAxeStrict(): boolean {
  const value = process.env.AXE_STRICT?.toLowerCase();
  return value === "1" || value === "true";
}
