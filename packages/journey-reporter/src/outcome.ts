import type { TestResultBundle } from "@openuji/journey-plugin";

type Failure = Readonly<{ name: string; message: string }>;

/** Every failure that makes a test fail: execution, reporting, and observer policy findings. */
export function testFailures(test: TestResultBundle): readonly Failure[] {
  return [...test.result.errors, ...test.reportingErrors, ...test.outputs.flatMap((output) => output.errors)];
}

/** The single pass rule shared by the host, the CLI, and the report viewer. */
export function testPassed(test: TestResultBundle): boolean {
  return test.result.ok && !test.reportingErrors.length && test.outputs.every((output) => !output.errors.length);
}
