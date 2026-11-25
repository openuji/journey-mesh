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
  /** Opaque CustomLocator extensions, interpreted only by a compatible executor. */
  extensions?: Readonly<Record<string, unknown>>;
  /** Model role identifier. Executors map its vocabulary to their runtime or reject it. */
  role?: string;
  accessibleName?: string;
  accessibleDescription?: string;
  features: readonly AccessibleFeature[];
  contexts: readonly ResolvedAccessibleLocator[];
};

export type ResolvedInputModality = LabeledRef;

export const keyboardInputModalityId = "observability:keyboard" as const;
/** Producer-defined text entry; RC4 Operability does not model value entry. */
export const keyboardTextEntryInputModalityId = "urn:openuji:input-modality:keyboard-text-entry" as const;
export const pointerInputModalityId = "observability:pointer" as const;

/** Operability move kinds that executors perform and that discovery reports. */
export const nextStopMoveKindId = "operability:nextStop" as const;
export const previousStopMoveKindId = "operability:previousStop" as const;
export const firstItemMoveKindId = "operability:firstItem" as const;
export const lastItemMoveKindId = "operability:lastItem" as const;
export const nextItemMoveKindId = "operability:nextItem" as const;
export const previousItemMoveKindId = "operability:previousItem" as const;
export const pointAtMoveKindId = "operability:pointAt" as const;

/** Built-in conveniences, not an exhaustive list of executable modalities. */
export const journeyInputModalityIds = [
  keyboardTextEntryInputModalityId,
  keyboardInputModalityId,
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
  /**
   * The configured journey this operation belongs to when several journeys are composed into one plan.
   * Hosts route execution by segment; `source` stays provenance only.
   */
  segment?: string;
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

/** One declared alternative, independent of runtime performability or platform gestures. */
export type ResolvedTransitionMaterialization = LabeledRef & {
  transitionId: string;
  modality: ResolvedInputModality;
  startLocator?: ResolvedAccessibleLocator;
  sourceStateId?: string;
  direction?: "operability:forward" | "operability:backward";
  steps: readonly ResolvedMaterializationStep[];
  extensions?: Readonly<Record<string, unknown>>;
};

/**
 * The `extensions` key that marks the TransitionMaterialization saying how its transition is expected
 * to be performed through its modality. Its presence marks it; UJG requires the value to be an object,
 * `{}`. A Journey Mesh convention until UJG specifies it. A run performs the canonical one first;
 * another materialization of the transition through the same modality is only the way on after it failed.
 */
export const canonicalMaterializationExtension = "urn:openuji:journey-mesh:canonical";

export function isCanonical(materialization: ResolvedTransitionMaterialization): boolean {
  return materialization.extensions?.[canonicalMaterializationExtension] !== undefined;
}

export type ResolvedMaterializationStep = LabeledRef & {
  kind: "move" | "activation" | "shortcut";
  previousStepId?: string;
  locator?: ResolvedAccessibleLocator;
  /** `focus` for a FocusMoveKind, `move` for a MoveKind: the model's type, never inferred from the IRI. */
  moveKind?: LabeledRef & { type: "focus" | "move" };
  extensions?: Readonly<Record<string, unknown>>;
};

/** The standard Operability move kinds by type, for code that makes steps itself rather than reading a model. */
export const standardMoveKindTypes: Readonly<Record<string, "focus" | "move">> = Object.freeze({
  [nextStopMoveKindId]: "focus",
  [previousStopMoveKindId]: "focus",
  [nextItemMoveKindId]: "focus",
  [previousItemMoveKindId]: "focus",
  [firstItemMoveKindId]: "focus",
  [lastItemMoveKindId]: "focus",
  [pointAtMoveKindId]: "move",
  "operability:nextPage": "move",
  "operability:previousPage": "move"
});

/**
 * What "the object the user is at" means for a step: focus, the pointer, or neither (`other`, a move
 * of the view or a kind no executor knows).
 */
export type StepPosition = "focus" | "pointer" | "other";

/**
 * Where the user is for `step` (Operability RC4). A MoveStep's kind decides what it moves: a
 * FocusMoveKind moves focus, `operability:pointAt` the pointer. Any other step acts where the last
 * MoveStep before it (in performance order) that moved focus or the pointer left the user. Before any
 * such move, the user is at the pointer in a pointer materialization and at focus otherwise.
 */
export function stepPosition(materialization: ResolvedTransitionMaterialization, step: ResolvedMaterializationStep): StepPosition {
  const moved = (item: ResolvedMaterializationStep): StepPosition =>
    item.moveKind?.type === "focus" ? "focus" : item.moveKind?.id === pointAtMoveKindId ? "pointer" : "other";
  if (step.kind === "move") return moved(step);
  const index = materialization.steps.findIndex((item) => item.id === step.id);
  for (const item of materialization.steps.slice(0, Math.max(index, 0)).reverse()) {
    if (item.kind !== "move") continue;
    const position = moved(item);
    if (position !== "other") return position;
  }
  return materialization.modality.id === pointerInputModalityId ? "pointer" : "focus";
}

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
  /**
   * Declared alternatives. A profile chooses at most one for its selected modality and passes it
   * in the InputModalityDecision; executors perform only that chain and never derive missing steps.
   */
  materializations?: readonly ResolvedTransitionMaterialization[];
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
  /**
   * The declared TransitionMaterialization to perform through `modality`. Absent only when the
   * profile allows unmaterialized transitions, or for producer text entry, which types at the current focus.
   */
  materialization?: ResolvedTransitionMaterialization;
  /**
   * Set only beside a canonical `materialization`: the runner performs this one when that fails, and
   * records the operation as failed.
   */
  fallback?: ResolvedTransitionMaterialization;
};
