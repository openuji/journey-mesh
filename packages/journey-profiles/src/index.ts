import type {
  InputModalityDecision,
  JourneyInteractionCommand,
  JourneyProfile,
  ResolvedInputModality,
  ResolvedInputModalityProfile,
  TransitionPlanOperation
} from "@openuji/journey-runner";

const keyboardTextEntryInputModalityId = "urn:input-modality:keyboard-text-entry";
const keyboardSpaceInputModalityId = "urn:input-modality:keyboard-space";
const keyboardEnterInputModalityId = "urn:input-modality:keyboard-enter";
const pointerInputModalityId = "urn:input-modality:pointer";

export function defaultProfile(): JourneyProfile {
  return {
    id: "default",
    label: "Default",
    selectInputModality(operation) {
      const preferredModalities = operation.activation.eventId.endsWith(":text-entry-activation")
        ? [keyboardTextEntryInputModalityId, pointerInputModalityId, keyboardEnterInputModalityId]
        : [
            pointerInputModalityId,
            keyboardEnterInputModalityId,
            keyboardSpaceInputModalityId,
            keyboardTextEntryInputModalityId
          ];

      return selectDecision("default", operation, preferredModalities);
    }
  };
}

export function keyboardOnlyProfile(): JourneyProfile {
  return {
    id: "keyboard-only",
    label: "Keyboard only",
    selectInputModality(operation) {
      return selectDecision("keyboard-only", operation, [
        keyboardTextEntryInputModalityId,
        keyboardEnterInputModalityId,
        keyboardSpaceInputModalityId
      ]);
    }
  };
}

function selectDecision(
  profileId: string,
  operation: TransitionPlanOperation,
  modalityPreference: string[]
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
  modalityId: string
): { profile: ResolvedInputModalityProfile; modality: ResolvedInputModality } | undefined {
  for (const profile of profiles) {
    const modality = profile.modalities.find((candidate) => candidate.id === modalityId);
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

function commandForModality(modalityId: string): JourneyInteractionCommand {
  switch (modalityId) {
    case pointerInputModalityId:
      return "pointer-click";
    case keyboardEnterInputModalityId:
      return "keyboard-enter";
    case keyboardSpaceInputModalityId:
      return "keyboard-space";
    case keyboardTextEntryInputModalityId:
      return "keyboard-text-entry";
    default:
      throw new Error(`Unsupported input modality ${modalityId}`);
  }
}
