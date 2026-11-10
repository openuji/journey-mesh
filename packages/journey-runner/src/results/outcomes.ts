import { errorToJourneyRunError } from "../errors.js";
import type { ExecutionResult, JourneyOutcome } from "./contracts.js";

export const passedOutcome = Object.freeze({ kind: "passed" as const });

export function failedOutcome(error: unknown): JourneyOutcome {
  return Object.freeze({ kind: "failed", error: Object.freeze(errorToJourneyRunError(error)) });
}

export function executionPassed(execution: ExecutionResult): boolean {
  return execution.outcome.kind === "passed";
}

/** Compose completed outcomes without replacing an earlier failure. */
export function combineOutcomes(
  original: JourneyOutcome,
  next: JourneyOutcome,
  phase: string
): JourneyOutcome {
  if (next.kind === "passed") return original;
  if (original.kind === "passed") return next;
  return failedOutcome({
    name: "AggregateError",
    message: `${original.error.message}; ${phase} failed: ${next.error.message}`,
    stack: [original.error.stack, next.error.stack].filter(Boolean).join("\n")
  });
}
