import type {
  JourneyOperation as CoreJourneyOperation,
  JourneyPlan as CoreJourneyPlan
} from "@openuji/journey-core";

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
  /** '*' leaves this feature unconstrained in the execution model. */
  value: string;
};

export type ResolvedAccessibleLocator = LabeledRef & {
  /** Model role identifier. Adapters map its vocabulary to their runtime or reject it. */
  role?: string;
  accessibleName?: string;
  accessibleDescription?: string;
  features: readonly AccessibleFeature[];
  contexts: readonly ResolvedAccessibleLocator[];
};

export type ResolvedInputModality = LabeledRef;

export const keyboardTextEntryInputModalityId = "observability:keyboard-text-entry" as const;
export const keyboardSpaceInputModalityId = "observability:keyboard-space" as const;
export const keyboardEnterInputModalityId = "observability:keyboard-enter" as const;
export const pointerInputModalityId = "observability:pointer" as const;

/** Built-in conveniences, not an exhaustive list of executable modalities. */
export const journeyInputModalityIds = [
  keyboardTextEntryInputModalityId,
  keyboardSpaceInputModalityId,
  keyboardEnterInputModalityId,
  pointerInputModalityId
] as const;

/** @deprecated Use string; modality IDs are open model identifiers. */
export type JourneyInputModalityId = string;

/** @deprecated Use ResolvedInputModality; this alias does not restrict modality IDs. */
export type ResolvedJourneyInputModality = ResolvedInputModality;

export type ResolvedInputModalityProfile = LabeledRef & {
  modalities: readonly ResolvedInputModality[];
};

export type ResolvedSurfaceInstanceResolver = LabeledRef & {
  instanceKeyFeature: AccessibleFeature;
};

export type ResolvedObservationBinding = LabeledRef & {
  surfaceId: string;
  eventId: string;
  eventLabel?: string;
  expectedMatchCount?: number;
  requiredInputModalityProfiles: readonly ResolvedInputModalityProfile[];
  locators: readonly ResolvedAccessibleLocator[];
  surfaceInstanceResolver?: ResolvedSurfaceInstanceResolver;
};

export type ResolvedStateObservation = {
  stateId: string;
  stateLabel?: string;
  surfaceId: string;
  surfaceLabel?: string;
  expectedMatchCount: number;
  bindings: readonly ResolvedObservationBinding[];
};

export type ResolvedStateObservationTarget = {
  observation: ResolvedStateObservation;
  expectedMatchCount: number;
  bindings: readonly ResolvedObservationBinding[];
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
  requiredInputModalityProfiles: readonly ResolvedInputModalityProfile[];
  bindings: readonly ResolvedObservationBinding[];
};

export type ResolvedArtifact = LabeledRef & {
  nameRef?: string;
  name?: string;
  sourceTouchpointRef?: string;
  targetTouchpointRefs: readonly string[];
};

export type ResolvedEffect = LabeledRef & {
  producedRefs: readonly string[];
  consumedRefs: readonly string[];
  produced: readonly ResolvedArtifact[];
  consumed: readonly ResolvedArtifact[];
};

export type JourneySourceReferenceValue = string | readonly string[];

export type JourneySourceReferences = Readonly<Record<string, JourneySourceReferenceValue>>;

export type JourneyPlanSource = {
  readonly model: string;
  readonly documentId?: string;
  readonly references?: JourneySourceReferences;
};

export type JourneyOperationSource = {
  readonly references?: JourneySourceReferences;
};

export type JourneyPlanOperationKind = "state" | "transition" | "control-flow";

export type JourneyPlanOperationBase<K extends JourneyPlanOperationKind> = CoreJourneyOperation<K> & {
  actorId: string;
  touchpointId: string;
  entry: JourneyEntryRef;
  entryBinding?: EntryBindingRef;
  source?: JourneyOperationSource;
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
  effects: readonly ResolvedEffect[];
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
  readonly source?: JourneyPlanSource;
};

/** Detach and deeply freeze a compiled plan before it crosses into execution. */
export function immutableJourneyPlan<T extends JourneyPlan>(plan: T): T {
  const copy = structuredClone(plan);
  const freeze = (value: unknown): void => {
    if (value !== null && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(copy);
  return copy;
}

export type InputModalityDecision = {
  profileId: string;
  inputModalityProfile: ResolvedInputModalityProfile;
  modality: ResolvedInputModality;
};
