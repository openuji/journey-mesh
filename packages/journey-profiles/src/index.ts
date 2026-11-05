import {
  keyboardEnterInputModalityId,
  keyboardSpaceInputModalityId,
  keyboardTextEntryInputModalityId,
  pointerInputModalityId,
  type InputModalityDecision,
  type ResolvedInputModality,
  type ResolvedInputModalityProfile,
  type TransitionPlanOperation
} from "@openuji/journey-execution-model";
import type { JourneyExecutionContext, JourneyProfile } from "@openuji/journey-runner";

export type JourneyProfileScope = Pick<JourneyProfile, "appliesTo">;

export type InputModalityProfileOptions = JourneyProfileScope & {
  id: string;
  label?: string;
  modalityPreference: readonly string[];
};

/** Select model-defined modalities without translating them into runtime commands. */
export function inputModalityProfile(options: InputModalityProfileOptions): JourneyProfile {
  const preference = Object.freeze([...options.modalityPreference]);
  return Object.freeze({
    id: options.id,
    ...(options.label ? { label: options.label } : {}),
    ...(options.appliesTo ? { appliesTo: options.appliesTo } : {}),
    selectInputModality(operation) {
      return selectDecision(options.id, operation, preference);
    }
  });
}

export function defaultProfile(scope: JourneyProfileScope = {}): JourneyProfile {
  return inputModalityProfile({
    ...scope,
    id: "default",
    label: "Default",
    modalityPreference: [
      pointerInputModalityId,
      keyboardEnterInputModalityId,
      keyboardSpaceInputModalityId,
      keyboardTextEntryInputModalityId
    ]
  });
}

export function keyboardOnlyProfile(scope: JourneyProfileScope = {}): JourneyProfile {
  return inputModalityProfile({
    ...scope,
    id: "keyboard-only",
    label: "Keyboard only",
    modalityPreference: [
      keyboardTextEntryInputModalityId,
      keyboardEnterInputModalityId,
      keyboardSpaceInputModalityId
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
  modalityPreference: readonly string[]
): InputModalityDecision {
  for (const modalityId of modalityPreference) {
    const match = findProfileWithSingleModality(operation.activation.requiredInputModalityProfiles, modalityId);
    if (match) return Object.freeze({ profileId, inputModalityProfile: match.profile, modality: match.modality });
  }
  throw new Error(`No supported input modality for ${operation.transition.id} in profile ${profileId}`);
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
