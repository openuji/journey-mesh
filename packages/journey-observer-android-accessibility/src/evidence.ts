import type { AndroidDeviceMetrics, AppiumOperationObservation } from "@openuji/journey-adapter-appium";
import type { JourneyExecutionDescriptor, JourneyPlanOperation, JourneyRunError } from "@openuji/journey-runner";
import type { AndroidHierarchy, AndroidHierarchyCheck } from "./hierarchy.js";
import type { Immutable } from "./immutable.js";

export type AndroidArtifact = Readonly<{ path: string; href: string }>;
export type AndroidArtifactWriter = (input: Readonly<{
  name: string; data: string | Uint8Array; contentType: string;
}>) => Promise<AndroidArtifact>;
/** Read UTF-8 XML or PNG bytes at the artifact I/O boundary. */
export type AndroidArtifactReader = (artifact: AndroidArtifact) => Promise<string | Uint8Array>;
export type AndroidCapture<T> =
  | Readonly<{ kind: "captured"; value: T }>
  | Readonly<{ kind: "not-requested" }>
  | Readonly<{ kind: "failed"; error: JourneyRunError }>;
export type AndroidOperationEvidence = Immutable<{
  runId: string;
  executionId: string;
  profileId: string;
  operation: JourneyPlanOperation;
  stage: AppiumOperationObservation["stage"];
  expectedMatchCount?: number;
  targets?: readonly string[];
  hierarchy?: AndroidCapture<{ nodes: AndroidHierarchy; artifact: AndroidArtifact }>;
  metrics?: AndroidCapture<AndroidDeviceMetrics>;
  screenshot?: AndroidCapture<AndroidArtifact>;
  checks: readonly AndroidHierarchyCheck[];
}>;
export type AndroidAccessibilityEvidence =
  | Immutable<{ kind: "execution-started"; execution: JourneyExecutionDescriptor }>
  | Readonly<{ kind: "operation-observed"; evidence: AndroidOperationEvidence }>;
