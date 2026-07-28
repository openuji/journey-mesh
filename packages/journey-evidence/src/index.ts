import type {
  JourneyPlanOperationKind
} from "@openuji/journey-execution-model";

export type {
  AccessibleFeature,
  ControlFlowPlanOperation,
  EntryBindingRef,
  GraphVertexRef,
  InputModalityDecision,
  JourneyEntryRef,
  JourneyInteractionCommand,
  JourneyPlan,
  JourneyPlanOperation,
  JourneyPlanOperationBase,
  JourneyPlanOperationKind,
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

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

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
