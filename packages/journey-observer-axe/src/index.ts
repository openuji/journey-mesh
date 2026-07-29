export { wcag22Tags } from "./constants.js";
export { axeObserver } from "./observer/axe-observer.js";
export { runAxeAudit } from "./audit/run-axe-audit.js";
export {
  axeFailureMessage,
  isAxeStrict,
  shouldFailForAxeViolations
} from "./audit/strict-mode.js";
export { buildAxePathAuditReport } from "./reporting/path-audit-report.js";
export { buildAxeAccessibilitySummaryReport } from "./reporting/accessibility-summary-report.js";

export type {
  AxeAccessibilitySummaryEntry,
  AxeAccessibilitySummaryProfile,
  AxeAccessibilitySummaryReport,
  AxeAuditMetadata,
  AxeAuditReport,
  AxeAuditRunner,
  AxeAuditRunnerInput,
  AxeAuditScanId,
  AxeAuditScanSummaries,
  AxeAuditSummary,
  AxeNode,
  AxeNodeEvidence,
  AxeObserver,
  AxeObserverOptions,
  AxePathAuditFinding,
  AxePathAuditFindingNode,
  AxePathAuditFindings,
  AxePathAuditItem,
  AxePathAuditItemInput,
  AxePathAuditItemStatus,
  AxePathAuditReport,
  AxePathAuditSummary,
  AxeResults,
  AxeRuleResult,
  AxeRuleResultType,
  AxeScanEvidence
} from "./types.js";
