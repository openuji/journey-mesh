import type { JourneyRunError } from "@openuji/journey-runner";
import type { TestRecord } from "./types.js";

type Verdict = Pick<TestRecord, "result" | "observers" | "observerErrors">;

/** Every failure that makes a test fail: execution errors, failed or throwing observers, and observer policy findings. */
export function testFailures(test: Verdict): readonly JourneyRunError[] {
  return [...test.result.errors, ...test.observerErrors, ...test.observers.flatMap((output) => output.errors)];
}

/** The single pass rule. It depends on execution and evidence only, never on reporting. */
export function testPassed(test: Verdict): boolean {
  return test.result.ok && !test.observerErrors.length && test.observers.every((output) => !output.errors.length);
}
