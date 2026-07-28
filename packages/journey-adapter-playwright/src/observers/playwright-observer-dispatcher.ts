import type { JourneyExecutionDescriptor } from "@openuji/journey-runner";

import type { PlaywrightEvidence } from "../evidence/playwright-evidence.js";
import type {
  PlaywrightExecutionObserver,
  PlaywrightOperationObservation
} from "./contracts.js";

export class PlaywrightObserverDispatcher {
  constructor(
    private readonly observers: readonly PlaywrightExecutionObserver[],
    private readonly execution: JourneyExecutionDescriptor,
    private readonly evidence: PlaywrightEvidence
  ) {}

  async executionStarted(): Promise<void> {
    for (const observer of this.observers) {
      if (!observer.onExecutionStarted) continue;

      this.evidence.observerExecutionStarted(observer);

      try {
        await observer.onExecutionStarted({ execution: this.execution });
        this.evidence.observerExecutionStartCompleted(observer);
      } catch (error) {
        this.evidence.observerExecutionStartFailed(observer, error);
        throw error;
      }
    }
  }

  async observe(observation: PlaywrightOperationObservation): Promise<void> {
    for (const observer of this.observers) {
      if (!observer.observeOperation) continue;

      this.evidence.observerOperationStarted(observer, observation);

      try {
        await observer.observeOperation(observation);
        this.evidence.observerOperationCompleted(observer, observation);
      } catch (error) {
        this.evidence.observerOperationFailed(observer, observation, error);
        throw error;
      }
    }
  }
}
