import { errorToEvidence, type EvidenceError } from "@openuji/journey-evidence";

import type { ExecutionEvidence } from "../evidence/execution-evidence.js";
import type { RunEvidence } from "../evidence/run-evidence.js";
import type { ExecutionResult, RunResult } from "../index.js";
import type {
  JourneyExecutionDescriptor,
  JourneyObserver,
  JourneyObserverRunStartedInput
} from "./contracts.js";

export class JourneyObserverDispatcher {
  constructor(
    private readonly journeyObservers: readonly JourneyObserver[],
    private readonly runEvidence: RunEvidence
  ) {}

  async runStarted(
    input: JourneyObserverRunStartedInput
  ): Promise<EvidenceError | undefined> {
    for (const observer of this.journeyObservers) {
      if (!observer.onRunStarted) continue;

      try {
        this.runEvidence.observerRunStarted(observer);
        await observer.onRunStarted(input);
        this.runEvidence.observerRunStartCompleted(observer);
      } catch (error) {
        const evidenceError = errorToEvidence(error);
        this.runEvidence.observerRunStartFailed(observer, evidenceError);
        return evidenceError;
      }
    }

    return undefined;
  }

  async executionStarted(
    execution: JourneyExecutionDescriptor,
    evidence: ExecutionEvidence
  ): Promise<void> {
    for (const observer of this.journeyObservers) {
      if (!observer.onExecutionStarted) continue;

      try {
        evidence.observerExecutionStarted(observer);
        await observer.onExecutionStarted({ execution });
        evidence.observerExecutionStartCompleted(observer);
      } catch (error) {
        evidence.observerExecutionStartFailed(observer, error);
        throw error;
      }
    }
  }

  async executionCompleted(
    execution: JourneyExecutionDescriptor,
    result: ExecutionResult,
    evidence: ExecutionEvidence
  ): Promise<EvidenceError | undefined> {
    for (const observer of this.journeyObservers) {
      if (!observer.onExecutionCompleted) continue;

      try {
        evidence.observerExecutionCompleted(observer);
        await observer.onExecutionCompleted({ execution, result });
        evidence.observerExecutionCompletionCompleted(observer);
      } catch (error) {
        const evidenceError = errorToEvidence(error);
        evidence.observerExecutionCompletionFailed(observer, evidenceError);
        return evidenceError;
      }
    }

    return undefined;
  }

  async runCompleted(result: RunResult): Promise<EvidenceError | undefined> {
    for (const observer of this.journeyObservers) {
      if (!observer.onRunCompleted) continue;

      try {
        this.runEvidence.observerRunCompleted(observer);
        await observer.onRunCompleted({ result });
        this.runEvidence.observerRunCompletionCompleted(observer);
      } catch (error) {
        const evidenceError = errorToEvidence(error);
        this.runEvidence.observerRunCompletionFailed(observer, evidenceError);
        return evidenceError;
      }
    }

    return undefined;
  }
}
