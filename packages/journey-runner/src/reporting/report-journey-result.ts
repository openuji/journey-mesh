import { ReporterPipeline } from "./reporter-pipeline.js";
import type {
  ReportJourneyResultInput,
  ReportJourneyResultOutcome
} from "./contracts.js";

export async function reportJourneyResult(
  input: ReportJourneyResultInput
): Promise<ReportJourneyResultOutcome> {
  const pipeline = new ReporterPipeline();
  const reporting = await pipeline.run({
    reporters: input.reporters,
    result: input.result
  });

  return {
    result: input.result,
    errors: reporting.errors
  };
}
