import type { IosAppiumOperationObservation, IosDeviceMetrics } from "@openuji/journey-executor-appium/observation";
import type { JourneyExecutionDescriptor, JourneyPlanOperation, JourneyRunError } from "@openuji/journey-runner";
import type { IosHierarchy, IosHierarchyCheck } from "./hierarchy.js";
import type { Immutable } from "@openuji/journey-core";

/** A capture registered in the test's artifact store. */
export type IosArtifact = Readonly<{ href: string }>;
export type IosArtifactWriter = (
  input: Readonly<{
    name: string;
    data: string | Uint8Array;
    contentType: string;
    scope?: import("@openuji/journey-plugin").ArtifactScope;
  }>
) => Promise<IosArtifact>;
/** Read UTF-8 XML or PNG bytes at the artifact I/O boundary. */
export type IosArtifactReader = (artifact: IosArtifact) => Promise<string | Uint8Array>;
export type IosCapture<T> =
  | Readonly<{ kind: "captured"; value: T }>
  | Readonly<{ kind: "not-requested" }>
  | Readonly<{ kind: "failed"; error: JourneyRunError }>;
export type IosOperationEvidence = Immutable<{
  runId: string;
  executionId: string;
  profileId: string;
  operation: JourneyPlanOperation;
  stage: IosAppiumOperationObservation["stage"];
  expectedMatchCount?: number;
  targets?: readonly string[];
  hierarchy?: IosCapture<{ nodes: IosHierarchy; artifact: IosArtifact }>;
  metrics?: IosCapture<IosDeviceMetrics>;
  screenshot?: IosCapture<IosArtifact>;
  notApplicable?: { phaseId: string; reason: string };
  checks: readonly IosHierarchyCheck[];
}>;
export type IosAccessibilityEvidence =
  | Immutable<{ kind: "execution-started"; execution: JourneyExecutionDescriptor }>
  | Readonly<{ kind: "operation-observed"; evidence: IosOperationEvidence }>;
