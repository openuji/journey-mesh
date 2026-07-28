import type {
  JourneyOperation as CoreJourneyOperation,
  JourneyPlan as CoreJourneyPlan
} from "@openuji/journey-core";

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type LabeledRef = {
  id: string;
  label?: string;
};

export type JourneyEntryRef = LabeledRef & {
  stateId: string;
};

export type EntryBindingRef = LabeledRef & {
  value: string;
};

export type AccessibleFeature = LabeledRef & {
  name: string;
  value: string;
};

export type ResolvedAccessibleLocator = LabeledRef & {
  role?: string;
  accessibleName?: string;
  accessibleDescription?: string;
  features: AccessibleFeature[];
  contexts: ResolvedAccessibleLocator[];
};

export type ResolvedInputModality = LabeledRef;

export type ResolvedInputModalityProfile = LabeledRef & {
  modalities: ResolvedInputModality[];
};

export type ResolvedSurfaceInstanceResolver = LabeledRef & {
  instanceKeyFeature: AccessibleFeature;
};

export type ResolvedObservationBinding = LabeledRef & {
  surfaceId: string;
  eventId: string;
  eventLabel?: string;
  expectedMatchCount?: number;
  requiredInputModalityProfiles: ResolvedInputModalityProfile[];
  locators: ResolvedAccessibleLocator[];
  surfaceInstanceResolver?: ResolvedSurfaceInstanceResolver;
};

export type ResolvedStateObservation = {
  stateId: string;
  stateLabel?: string;
  surfaceId: string;
  surfaceLabel?: string;
  expectedMatchCount: number;
  bindings: ResolvedObservationBinding[];
};

export type ResolvedStateObservationTarget = {
  observation: ResolvedStateObservation;
  expectedMatchCount: number;
  bindings: ResolvedObservationBinding[];
};

export type GraphVertexRef = LabeledRef & {
  type: "State" | "CompositeState" | "JourneyExit";
};

export type ResolvedTransitionActivation = {
  transitionId: string;
  transitionLabel?: string;
  eventId: string;
  eventLabel?: string;
  from: GraphVertexRef;
  to: GraphVertexRef;
  effectRef?: string;
  surfaceId: string;
  surfaceLabel?: string;
  requiredInputModalityProfiles: ResolvedInputModalityProfile[];
  bindings: ResolvedObservationBinding[];
};

export type ResolvedArtifact = LabeledRef & {
  nameRef?: string;
  name?: string;
  sourceTouchpointRef?: string;
  targetTouchpointRefs: string[];
};

export type ResolvedEffect = LabeledRef & {
  producedRefs: string[];
  consumedRefs: string[];
  produced: ResolvedArtifact[];
  consumed: ResolvedArtifact[];
};

export type JourneyPlanOperationKind = "state" | "transition" | "control-flow";

export type JourneyPlanOperationBase<K extends JourneyPlanOperationKind> = CoreJourneyOperation<K> & {
  documentId: string;
  phaseId: string;
  stepId: string;
  userId: string;
  touchpointId: string;
  entry: JourneyEntryRef;
  entryBinding?: EntryBindingRef;
};

export type StatePlanOperation = JourneyPlanOperationBase<"state"> & {
  state: LabeledRef;
  surface: LabeledRef;
  target: ResolvedStateObservationTarget;
};

export type TransitionPlanOperation = JourneyPlanOperationBase<"transition"> & {
  transition: LabeledRef & {
    from: string;
    to: string;
    effectRef?: string;
  };
  from: GraphVertexRef;
  to: GraphVertexRef;
  surface: LabeledRef;
  activation: ResolvedTransitionActivation;
  effects: ResolvedEffect[];
};

export type ControlFlowPlanOperation = JourneyPlanOperationBase<"control-flow"> & {
  transition: LabeledRef & {
    from: string;
    to: string;
    fromExitRef?: string;
    toEntryRef?: string;
  };
  fromExit?: LabeledRef;
  toEntry?: JourneyEntryRef;
};

export type JourneyPlanOperation =
  | StatePlanOperation
  | TransitionPlanOperation
  | ControlFlowPlanOperation;

export type JourneyPlan = CoreJourneyPlan<JourneyPlanOperation> & {
  documentId: string;
};

export type JourneyInteractionCommand =
  | "pointer-click"
  | "keyboard-enter"
  | "keyboard-space"
  | "keyboard-text-entry";

export type InputModalityDecision = {
  profileId: string;
  inputModalityProfile: ResolvedInputModalityProfile;
  modality: ResolvedInputModality;
  command: JourneyInteractionCommand;
};

export type UjgRefSet = {
  documentId?: string;
  phaseId?: string;
  stepId?: string;
  userId?: string;
  touchpointId?: string;
  entryId?: string;
  entryBindingId?: string;
  stateId?: string;
  transitionId?: string;
  surfaceId?: string;
  observationBindingIds?: string[];
  observationEventIds?: string[];
  locatorIds?: string[];
  featureIds?: string[];
  effectIds?: string[];
  artifactIds?: string[];
};

export type EvidenceError = {
  name: string;
  message: string;
  stack?: string;
};

export type EvidenceEvent = {
  id: string;
  sequence: number;
  timestamp: string;
  runId: string;
  executionId?: string;
  profileId?: string;
  operationId?: string;
  operationKind?: JourneyPlanOperationKind;
  type: string;
  ok?: boolean;
  message?: string;
  ujg?: UjgRefSet;
  data?: JsonValue;
  error?: EvidenceError;
};

export type EvidenceEventInput = Omit<EvidenceEvent, "id" | "sequence" | "timestamp" | "runId">;

export class EvidenceRecorder {
  readonly runId: string;
  private sequence = 0;
  private readonly collectedEvents: EvidenceEvent[] = [];

  constructor(runId: string) {
    this.runId = runId;
  }

  emit(input: EvidenceEventInput): EvidenceEvent {
    const sequence = this.sequence++;
    const event: EvidenceEvent = {
      ...input,
      id: `event-${String(sequence).padStart(5, "0")}`,
      sequence,
      timestamp: new Date().toISOString(),
      runId: this.runId
    };

    this.collectedEvents.push(event);
    return event;
  }

  snapshot(): EvidenceEvent[] {
    return [...this.collectedEvents];
  }
}

export function errorToEvidence(error: unknown): EvidenceError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: "Error",
    message: String(error)
  };
}
