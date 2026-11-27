/**
 * What the iOS accessibility observer records, for consumers of run records.
 * Types and pure helpers only: importing this entry loads no device runtime.
 */
export type * from "./evidence.js";
export type * from "./hierarchy.js";
export { assessIosOperations, iosAccessibilityFindings, iosAccessibilityKind, iosExecutorName } from "./classify.js";
export type { IosOperationAssessment } from "./classify.js";
export { isIosAccessibilityOutput } from "./output.js";
export type { IosAccessibilityObserverOutput, IosRecordedEvidence } from "./output.js";
