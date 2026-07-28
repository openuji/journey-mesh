import { errorToEvidence, type EvidenceError } from "@openuji/journey-evidence";

import type { RunEvidence } from "../evidence/run-evidence.js";
import type { JourneyReporter, RunResult } from "../index.js";

export type ReporterPipelineInput = {
  readonly reporters: readonly JourneyReporter[];
  readonly report: RunResult;
  readonly evidence: RunEvidence;
};

export type ReporterPipelineResult = {
  readonly errors: readonly EvidenceError[];
};

export class ReporterPipeline {
  async run(input: ReporterPipelineInput): Promise<ReporterPipelineResult> {
    const errors: EvidenceError[] = [];

    for (const reporter of input.reporters) {
      input.evidence.reporterStarted(reporter);

      try {
        await reporter.report(input.report);
        input.evidence.reporterCompleted(reporter);
      } catch (error) {
        const evidenceError = errorToEvidence(error);
        errors.push(evidenceError);
        input.evidence.reporterFailed(reporter, evidenceError);
      }
    }

    return { errors };
  }
}
