import type { JourneyExecutionDescriptor } from "@openuji/journey-runner";

import type {
  PlaywrightExecutionObserver,
  PlaywrightOperationObservation
} from "./contracts.js";

export class PlaywrightObserverDispatcher {
  constructor(
    private readonly observers: readonly PlaywrightExecutionObserver[],
    private readonly execution: JourneyExecutionDescriptor
  ) {}

  async executionStarted(): Promise<void> {
    for (const observer of this.observers) {
      if (!observer.onExecutionStarted) continue;

      await observer.onExecutionStarted({ execution: this.execution });
    }
  }

  async observe(observation: PlaywrightOperationObservation): Promise<void> {
    for (const observer of this.observers) {
      if (!observer.observeOperation) continue;

      await observer.observeOperation(observation);
    }
  }
}
