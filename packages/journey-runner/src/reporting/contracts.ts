import type { JourneyRunError } from "../errors.js";
import type { RunResult } from "../results/contracts.js";

export type JourneyReporterInput = {
  readonly result: RunResult;
  readonly json: string;
};

export type JourneyReporter = {
  name: string;
  version?: string;
  report(input: JourneyReporterInput): Promise<void> | void;
};

export type ReportJourneyResultInput = {
  readonly reporters: readonly JourneyReporter[];
  readonly result: RunResult;
};

export type ReportJourneyResultOutcome = {
  /**
   * Exact result supplied by the caller.
   */
  readonly result: RunResult;

  /**
   * Failures produced while writing, attaching, rendering, or uploading output.
   */
  readonly errors: readonly JourneyRunError[];
};
