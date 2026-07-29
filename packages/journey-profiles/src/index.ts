import {
  keyboardEnterInputModalityId,
  keyboardSpaceInputModalityId,
  keyboardTextEntryInputModalityId,
  pointerInputModalityId,
  type InputModalityDecision,
  type JourneyInputModalityId,
  type JourneyInteractionCommand,
  type ResolvedInputModality,
  type ResolvedInputModalityProfile,
  type ResolvedJourneyInputModality,
  type TransitionPlanOperation
} from "@openuji/journey-execution-model";
import type { JourneyProfile } from "@openuji/journey-runner";

const defaultModalityPreference = [
  pointerInputModalityId,
  keyboardEnterInputModalityId,
  keyboardSpaceInputModalityId,
  keyboardTextEntryInputModalityId
] satisfies readonly JourneyInputModalityId[];

const keyboardOnlyModalityPreference = [
  keyboardTextEntryInputModalityId,
  keyboardEnterInputModalityId,
  keyboardSpaceInputModalityId
] satisfies readonly JourneyInputModalityId[];

const commandByModalityId: Record<JourneyInputModalityId, JourneyInteractionCommand> = {
  [pointerInputModalityId]: "pointer-click",
  [keyboardEnterInputModalityId]: "keyboard-enter",
  [keyboardSpaceInputModalityId]: "keyboard-space",
  [keyboardTextEntryInputModalityId]: "keyboard-text-entry"
};

type SingleModalityProfileMatch = {
  profile: ResolvedInputModalityProfile;
  modality: ResolvedJourneyInputModality;
};

export function defaultProfile(): JourneyProfile {
  return {
    id: "default",
    label: "Default",
    selectInputModality(operation) {
      return selectDecision("default", operation, defaultModalityPreference);
    }
  };
}

export function keyboardOnlyProfile(): JourneyProfile {
  return {
    id: "keyboard-only",
    label: "Keyboard only",
    selectInputModality(operation) {
      return selectDecision("keyboard-only", operation, keyboardOnlyModalityPreference);
    }
  };
}

function selectDecision(
  profileId: string,
  operation: TransitionPlanOperation,
  modalityPreference: readonly JourneyInputModalityId[]
): InputModalityDecision {
  for (const modalityId of modalityPreference) {
    const match = findProfileWithSingleModality(
      operation.activation.requiredInputModalityProfiles,
      modalityId
    );

    if (match) {
      return {
        profileId,
        inputModalityProfile: match.profile,
        modality: match.modality,
        command: commandForModality(match.modality.id)
      };
    }
  }

  throw new Error(
    `No supported input modality for ${operation.transition.id} in profile ${profileId}`
  );
}

function findProfileWithSingleModality(
  profiles: ResolvedInputModalityProfile[],
  modalityId: JourneyInputModalityId
): SingleModalityProfileMatch | undefined {
  for (const profile of profiles) {
    const modality = profile.modalities.find(
      (candidate): candidate is ResolvedJourneyInputModality =>
        hasJourneyInputModalityId(candidate, modalityId)
    );
    if (!modality) continue;

    if (profile.modalities.length !== 1) {
      throw new Error(
        `InputModalityProfile ${profile.id} must contain exactly one modality for v1 execution`
      );
    }

    return { profile, modality };
  }

  return undefined;
}

function hasJourneyInputModalityId(
  modality: ResolvedInputModality,
  modalityId: JourneyInputModalityId
): modality is ResolvedJourneyInputModality {
  return modality.id === modalityId;
}

function commandForModality(modalityId: JourneyInputModalityId): JourneyInteractionCommand {
  return commandByModalityId[modalityId];
}
