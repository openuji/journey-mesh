import type {
  JourneyPlanOperationKind,
  JourneySourceReferences
} from "@openuji/journey-execution-model";

export { referencesForOperation, referencesForPlan } from "./journey-references.js";

export type {
  AccessibleFeature,
  ControlFlowPlanOperation,
  EntryBindingRef,
  GraphVertexRef,
  InputModalityDecision,
  JourneyEntryRef,
  JourneyInteractionCommand,
  JourneyPlan,
  JourneyOperationSource,
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

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JourneyEvidenceSource = {
  model: string;
  documentId?: string;
  planReferences?: JourneySourceReferences;
  operationReferences?: JourneySourceReferences;
};

export type JourneyReferenceSet = {
  actorId?: string;
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
  source?: JourneyEvidenceSource;
};

/**
 * @deprecated Use JourneyReferenceSet.
 */
export type UjgRefSet = JourneyReferenceSet;

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
  references?: JourneyReferenceSet;
  data?: JsonValue;
  error?: EvidenceError;
};

export type EvidenceEventInput = Omit<EvidenceEvent, "id" | "sequence" | "timestamp" | "runId">;

export interface EvidenceSink {
  emit(input: EvidenceEventInput): EvidenceEvent;
}

export interface EvidenceLog {
  snapshot(): readonly EvidenceEvent[];
}

export type ExecutionEvidenceIdentity = {
  readonly executionId: string;
  readonly profileId: string;
};

export interface ExecutionEvidenceSink {
  emit(
    input: Omit<
      EvidenceEventInput,
      "executionId" | "profileId"
    >
  ): EvidenceEvent;
}

export type EvidenceComponent = {
  readonly name: string;
  readonly version?: string;
};

export function componentEvidence(component: EvidenceComponent): JsonObject {
  return {
    name: component.name,
    ...(component.version ? { version: component.version } : {})
  };
}

export function scopeEvidenceToExecution(
  sink: EvidenceSink,
  identity: ExecutionEvidenceIdentity
): ExecutionEvidenceSink {
  return {
    emit(input) {
      return sink.emit({
        ...input,
        executionId: identity.executionId,
        profileId: identity.profileId
      });
    }
  };
}

export class EvidenceRecorder implements EvidenceSink, EvidenceLog {
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

  snapshot(): readonly EvidenceEvent[] {
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
