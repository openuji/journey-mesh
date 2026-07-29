import type { AxeAuditReport } from "../types.js";

export function shouldFailForAxeViolations(report: AxeAuditReport): boolean {
  return report.strict && report.summary.violations > 0;
}

export function axeFailureMessage(report: AxeAuditReport): string {
  return [
    `Axe found ${report.summary.violations} WCAG violation(s) for ${report.auditId}.`,
    "See the attached JSON and HTML axe reports for details."
  ].join(" ");
}

export function isAxeStrict(): boolean {
  const value = process.env.AXE_STRICT?.toLowerCase();
  return value === "1" || value === "true";
}
