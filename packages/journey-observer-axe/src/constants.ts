export const wcag22Tags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa"
] as const;

export const axeScopeAttribute = "data-axe-audit-scope";
export const observerName = "@openuji/journey-observer-axe";
/** `JourneyObserverOutput.kind` of this observer. */
export const axeObserverKind = "axe";
/** `format` of raw audit evidence files (`<auditId>.axe.json`). */
export const axeAuditFormat = "journey-mesh/axe-audit";
/**
 * The executor this observer observes. Kept as a literal so evidence consumers need no browser runtime;
 * a test checks it equals `playwrightExecutorName`.
 */
export const axeExecutorName = "@openuji/journey-executor-playwright";
