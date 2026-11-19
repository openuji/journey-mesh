/**
 * What the Android accessibility observer records, for consumers of run records.
 * Types and pure helpers only: importing this entry loads no device runtime.
 */
export type * from "./evidence.js";
export type * from "./hierarchy.js";
export { androidAccessibilityFindings, androidAccessibilityKind, androidAdapterName, assessAndroidOperations } from "./classify.js";
export type { AndroidOperationAssessment } from "./classify.js";
export { isAndroidAccessibilityOutput } from "./output.js";
export type { AndroidAccessibilityObserverOutput, AndroidRecordedEvidence } from "./output.js";
