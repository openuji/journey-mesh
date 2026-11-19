export { wcag22Tags } from "./constants.js";
export { axeObserver } from "./observer/axe-observer.js";
export { runAxeAudit } from "./audit/run-axe-audit.js";
export { buildAxeAuditReport } from "./audit/audit-report.js";
export {
  axeFailureMessage,
  isAxeStrict,
  shouldFailForAxeViolations,
  strictAxeFailureReports
} from "./audit/strict-mode.js";
export * from "./evidence.js";
export type { AxeAuditRunner, AxeAuditRunnerInput, AxeObserver, AxeObserverOptions } from "./types.js";
