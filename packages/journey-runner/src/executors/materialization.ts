import type { ResolvedTransitionMaterialization } from "@openuji/journey-execution-model";

/**
 * A start or step check of the TransitionMaterialization being performed failed. An executor throws it
 * from `performTransition`; nothing else it throws fails a materialization, so no fallback follows that.
 */
export class MaterializationFailedError extends Error {
  override readonly name = "MaterializationFailedError";

  constructor(
    message: string,
    /** Whether input had been sent to the application while performing the materialization. */
    readonly sentInput: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
  }

  /** Decided by name, so an executor that loads its own copy of this package is understood too. */
  static is(error: unknown): error is MaterializationFailedError {
    return error instanceof Error && error.name === "MaterializationFailedError"
      && typeof (error as Partial<MaterializationFailedError>).sentInput === "boolean";
  }
}

/**
 * Whether `fallback` may be performed after a materialization failed. With no input sent, the user is
 * still where the transition began. Otherwise the fallback has to name its start, which the executor
 * checks before its steps.
 */
export function fallbackApplies(fallback: ResolvedTransitionMaterialization, sentInput: boolean): boolean {
  return !sentInput || fallback.startLocator !== undefined;
}
