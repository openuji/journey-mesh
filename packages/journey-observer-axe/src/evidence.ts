/**
 * What the axe observer records, for consumers of run records (reports, dashboards, comparisons).
 * Types and pure helpers only: importing this entry loads no browser runtime.
 */
export { axeExecutorName, axeAuditFormat, axeObserverKind, wcag22Tags } from "./constants.js";
export { isAxeOutput } from "./output.js";
export type { AxeObserverOutput, AxeRecordedEvidence, LinkedAxeFact } from "./output.js";
export type { AxeEvidence, AxeEvidenceRef, AxeOperationEvidence, AxeAuditEvidence, AxeScreenshotEvidence } from "./observer/evidence.js";
export { createAxeJourneyItem } from "./journey/journey-item.js";
export { metadataForOperation, planSourceMetadata } from "./journey/operation-metadata.js";
export { shouldFailForAxeViolations } from "./audit/strict-mode.js";
export { addAxeScanSummaries, addAxeSummaries, emptyAxeSummary, emptyScanSummaries, summarizeResults } from "./audit/summary.js";
export { safeFileSegment, stringMetadataValue, stringTargets, urlPath } from "./shared/strings.js";
export type {
  AxeAuditMetadata, AxeAuditReport, AxeAuditScanId, AxeAuditScanSummaries, AxeAuditSummary, AxeJourneyItem, AxeJourneyOperation,
  AxeNode, AxeNodeEvidence, AxeResults, AxeRuleResult, AxeRuleResultType, AxeScanEvidence
} from "./types.js";
