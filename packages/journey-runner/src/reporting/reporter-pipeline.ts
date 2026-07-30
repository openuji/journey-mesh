import {
  errorToJourneyRunError,
  type JourneyRunError
} from "../errors.js";
import type { JourneyReporter } from "./contracts.js";
import type { RunResult } from "../index.js";

export type ReporterPipelineInput = {
  readonly reporters: readonly JourneyReporter[];
  readonly result: RunResult;
};

export type ReporterPipelineResult = {
  readonly errors: readonly JourneyRunError[];
};

export class ReporterPipeline {
  async run(input: ReporterPipelineInput): Promise<ReporterPipelineResult> {
    const errors: JourneyRunError[] = [];
    const json = JSON.stringify(input.result, null, 2);

    for (const reporter of input.reporters) {
      try {
        await reporter.report({
          result: input.result,
          json
        });
      } catch (error) {
        errors.push(errorToJourneyRunError(error));
      }
    }

    return { errors };
  }
}
