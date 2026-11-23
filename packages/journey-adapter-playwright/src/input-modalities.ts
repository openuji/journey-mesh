import {
  keyboardInputModalityId,
  keyboardTextEntryInputModalityId,
  pointerInputModalityId
} from "@openuji/journey-execution-model";

export type PlaywrightInteractionCommand =
  | "pointer-click"
  | "keyboard-activate"
  | "keyboard-text-entry";

const commands: Readonly<Record<string, PlaywrightInteractionCommand>> = Object.freeze({
  [pointerInputModalityId]: "pointer-click",
  [keyboardInputModalityId]: "keyboard-activate",
  [keyboardTextEntryInputModalityId]: "keyboard-text-entry"
});

export function playwrightCommandForModality(modalityId: string): PlaywrightInteractionCommand {
  const command = commands[modalityId];
  if (!command) throw new Error(`Playwright adapter does not support input modality ${modalityId}`);
  return command;
}

