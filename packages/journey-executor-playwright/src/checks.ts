import type { PlaywrightCheck } from "./observers/contracts.js";

/**
 * A check of what the model declares failed: the page is not as declared. Only this error is shown to
 * observers as a failed operation; a missing key setting or a browser error is not one.
 */
export class PlaywrightCheckError extends Error {
  constructor(message: string, readonly check: PlaywrightCheck, options?: ErrorOptions) {
    super(message, options);
  }
}

/** The check that `error`, or the error it wraps, reports as failed. */
export function failedCheck(error: unknown): PlaywrightCheck | undefined {
  if (error instanceof PlaywrightCheckError) return error.check;
  return error instanceof Error && error.cause instanceof PlaywrightCheckError ? error.cause.check : undefined;
}
