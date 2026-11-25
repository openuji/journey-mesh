import {
  isCanonical,
  keyboardInputModalityId,
  keyboardTextEntryInputModalityId,
  pointerInputModalityId,
  type InputModalityDecision,
  type ResolvedInputModality,
  type ResolvedInputModalityProfile,
  type ResolvedTransitionMaterialization,
  type TransitionPlanOperation
} from "@openuji/journey-execution-model";
import type { JourneyExecutionContext, JourneyProfile } from "@openuji/journey-runner";

export type JourneyProfileScope = Pick<JourneyProfile, "appliesTo">;

/** How a profile chooses among declared TransitionMaterializations. */
export type MaterializationSelectionOptions = {
  /**
   * Materialization IRIs to run when a transition declares several through the selected
   * modality. The first listed candidate wins; source order never decides. A canonical
   * materialization always runs first, so beside one this chooses its fallback.
   */
  materializationPreference?: readonly string[];
  /**
   * When true (the default), a transition without a materialization through the selected
   * modality is rejected. Producer text entry is exempt: it types at the current focus, and its
   * materialization only declares the focus moves that reach the field.
   */
  requireMaterialization?: boolean;
};

export type InputModalityProfileOptions = JourneyProfileScope & MaterializationSelectionOptions & {
  id: string;
  label?: string;
  modalityPreference: readonly string[];
};

/** Select model-defined modalities and declared materializations without translating them into runtime commands. */
export function inputModalityProfile(options: InputModalityProfileOptions): JourneyProfile {
  const preference = Object.freeze([...options.modalityPreference]);
  const selection = Object.freeze({
    materializationPreference: Object.freeze([...(options.materializationPreference ?? [])]),
    requireMaterialization: options.requireMaterialization ?? true
  });
  return Object.freeze({
    id: options.id,
    ...(options.label ? { label: options.label } : {}),
    ...(options.appliesTo ? { appliesTo: options.appliesTo } : {}),
    selectInputModality(operation) {
      return selectDecision(options.id, operation, preference, selection);
    }
  });
}

export function defaultProfile(scope: JourneyProfileScope & MaterializationSelectionOptions = {}): JourneyProfile {
  return inputModalityProfile({
    ...scope,
    id: "default",
    label: "Default",
    modalityPreference: [
      pointerInputModalityId,
      keyboardInputModalityId,
      keyboardTextEntryInputModalityId
    ]
  });
}

export function keyboardOnlyProfile(scope: JourneyProfileScope & MaterializationSelectionOptions = {}): JourneyProfile {
  return inputModalityProfile({
    ...scope,
    id: "keyboard-only",
    label: "Keyboard only",
    modalityPreference: [
      keyboardTextEntryInputModalityId,
      keyboardInputModalityId
    ]
  });
}

/** Choose a profile for each touchpoint while retaining one complete journey execution. */
export function touchpointProfile(options: {
  id: string;
  label?: string;
  profiles: Readonly<Record<string, JourneyProfile>>;
}): JourneyProfile {
  const profiles = Object.freeze({ ...options.profiles });
  const childContext = (context: JourneyExecutionContext, profile: JourneyProfile) => ({ ...context, profile });
  return Object.freeze({
    id: options.id,
    ...(options.label ? { label: options.label } : {}),
    async appliesTo(operation, context) {
      const profile = profiles[operation.touchpointId];
      if (!profile) return false;
      return await profile.appliesTo?.(operation, childContext(context, profile)) ?? true;
    },
    async selectInputModality(operation, context) {
      const profile = profiles[operation.touchpointId];
      if (!profile) throw new Error(`No profile for touchpoint ${operation.touchpointId}`);
      if (!profile.selectInputModality) {
        throw new Error(`Profile ${profile.id} has no input modality selector for transition ${operation.transition.id}`);
      }
      const decision = await profile.selectInputModality(operation, childContext(context, profile));
      return Object.freeze({ ...decision, profileId: options.id });
    }
  });
}

function selectDecision(
  profileId: string,
  operation: TransitionPlanOperation,
  modalityPreference: readonly string[],
  selection: Required<MaterializationSelectionOptions>
): InputModalityDecision {
  for (const modalityId of modalityPreference) {
    const match = findProfileWithSingleModality(operation.activation.requiredInputModalityProfiles, modalityId);
    if (!match) continue;
    const materialization = selectMaterialization(profileId, operation, match.modality, selection);
    const fallback = selectFallback(profileId, operation, match.modality, selection);
    return Object.freeze({
      profileId,
      inputModalityProfile: match.profile,
      modality: match.modality,
      ...(materialization ? { materialization } : {}),
      ...(fallback ? { fallback } : {})
    });
  }
  throw new Error(`No supported input modality for ${operation.transition.id} in profile ${profileId}`);
}

/** Choose the one declared materialization to perform first: the canonical one, else never guess among several. */
export function selectMaterialization(
  profileId: string,
  operation: TransitionPlanOperation,
  modality: ResolvedInputModality,
  selection: Required<MaterializationSelectionOptions>
): ResolvedTransitionMaterialization | undefined {
  const candidates = declaredThrough(operation, modality);
  const canonical = candidates.filter(isCanonical);
  if (canonical.length > 1) {
    throw new Error(
      `Transition ${operation.transition.id} declares ${canonical.length} canonical TransitionMaterializations through ${modality.id} ` +
      `(${canonical.map((candidate) => candidate.id).join(", ")}); only one can be canonical`
    );
  }
  if (canonical.length === 1) return canonical[0];
  if (candidates.length) return chooseOne(profileId, operation, modality, candidates, selection);
  if (modality.id === keyboardTextEntryInputModalityId || !selection.requireMaterialization) return undefined;
  throw new Error(
    `Transition ${operation.transition.id} has no TransitionMaterialization through ${modality.id} (profile ${profileId}); ` +
    "declare the steps in the UJG document"
  );
}

/** Beside a canonical materialization, the declared one to perform when it fails. */
function selectFallback(
  profileId: string,
  operation: TransitionPlanOperation,
  modality: ResolvedInputModality,
  selection: Required<MaterializationSelectionOptions>
): ResolvedTransitionMaterialization | undefined {
  const candidates = declaredThrough(operation, modality);
  if (!candidates.some(isCanonical)) return undefined;
  const others = candidates.filter((candidate) => !isCanonical(candidate));
  return others.length ? chooseOne(profileId, operation, modality, others, selection) : undefined;
}

function declaredThrough(operation: TransitionPlanOperation, modality: ResolvedInputModality): ResolvedTransitionMaterialization[] {
  return (operation.materializations ?? []).filter((candidate) => candidate.modality.id === modality.id);
}

function chooseOne(
  profileId: string,
  operation: TransitionPlanOperation,
  modality: ResolvedInputModality,
  candidates: readonly ResolvedTransitionMaterialization[],
  selection: Required<MaterializationSelectionOptions>
): ResolvedTransitionMaterialization {
  if (candidates.length === 1) return candidates[0]!;
  const preferred = selection.materializationPreference.find((id) => candidates.some((candidate) => candidate.id === id));
  if (preferred) return candidates.find((candidate) => candidate.id === preferred)!;
  throw new Error(
    `Transition ${operation.transition.id} declares ${candidates.length} TransitionMaterializations through ${modality.id} ` +
    `(${candidates.map((candidate) => candidate.id).join(", ")}); list the one to run in profile ${profileId} option materializationPreference`
  );
}

function findProfileWithSingleModality(
  profiles: readonly ResolvedInputModalityProfile[],
  modalityId: string
): { profile: ResolvedInputModalityProfile; modality: ResolvedInputModality } | undefined {
  for (const profile of profiles) {
    const modality = profile.modalities.find((candidate) => candidate.id === modalityId);
    if (!modality) continue;
    if (profile.modalities.length !== 1) {
      throw new Error(`InputModalityProfile ${profile.id} must contain exactly one modality for v1 execution`);
    }
    return { profile, modality };
  }
  return undefined;
}
