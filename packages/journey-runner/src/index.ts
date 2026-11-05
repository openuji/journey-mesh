export {
  componentDescriptor,
  executionDescriptor,
  profileDescriptor
} from "./observers/contracts.js";
export {
  reportJourneyResult
} from "./reporting/report-journey-result.js";
export { errorToJourneyRunError } from "./errors.js";
export { runJourney } from "./run-journey.js";
export { routedAdapter } from "./adapters/routed-adapter.js";
export { touchpointAdapter } from "./adapters/touchpoint-adapter.js";
export { executionPassed } from "./results/outcomes.js";

export type {
  AccessibleFeature,
  ControlFlowPlanOperation,
  EntryBindingRef,
  GraphVertexRef,
  InputModalityDecision,
  JourneyEntryRef,
  JourneyOperationSource,
  JourneyPlan,
  JourneyPlanOperation,
  JourneyPlanOperationBase,
  JourneyPlanOperationKind,
  JourneyPlanSource,
  JourneySourceReferences,
  JourneySourceReferenceValue,
  LabeledRef,
  ResolvedAccessibleLocator,
  ResolvedArtifact,
  ResolvedEffect,
  ResolvedInputModality,
  ResolvedInputModalityProfile,
  ResolvedObservationBinding,
  ResolvedStateObservation,
  ResolvedStateObservationTarget,
  ResolvedSurfaceInstanceResolver,
  ResolvedTransitionActivation,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";
export type { JourneyRunError } from "./errors.js";
export type {
  AdapterExecutionContext,
  JourneyAdapter,
  JourneyAdapterCloseInput,
  JourneyAdapterExecution,
  JourneyAdapterExecutionInput,
  JourneyExecutionContext,
  JourneyProfile
} from "./adapters/contracts.js";
export type { JourneyTouchpointAdapters } from "./adapters/touchpoint-adapter.js";
export type { RunJourneyOptions } from "./run-journey.js";
export type {
  JourneyComponentDescriptor,
  JourneyExecutionDescriptor,
  JourneyObserver,
  JourneyObserverExecutionCompletedInput,
  JourneyObserverExecutionStartedInput,
  JourneyObserverRunCompletedInput,
  JourneyObserverRunStartedInput,
  JourneyProfileDescriptor
} from "./observers/contracts.js";
export type {
  JourneyProgressEvent,
  JourneyProgressSink
} from "./progress/contracts.js";
export type {
  JourneyReporter,
  JourneyReporterInput,
  ReportJourneyResultInput,
  ReportJourneyResultOutcome
} from "./reporting/contracts.js";
export type {
  JourneyEffectVerificationInput,
  JourneyEnvironment,
  JourneyEnvironmentTeardownInput
} from "./environment/contracts.js";
export type {
  ExecutionResult,
  JourneyExecutionEvidence,
  JourneyOperationEvidence,
  JourneyOutcome,
  JourneyProfileAssessment,
  RunResult
} from "./results/contracts.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
