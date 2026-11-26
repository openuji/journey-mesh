import type { JourneyInputAction } from "@openuji/journey-core";
import type { JourneyExecutionDescriptor } from "@openuji/journey-runner";

import type {
  PlaywrightExecutionObserver,
  PlaywrightFailureObservation,
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

  async action(action: JourneyInputAction): Promise<void> {
    for (const observer of this.observers) await observer.onAction?.(Object.freeze({ ...action }));
  }

  async observe(observation: PlaywrightOperationObservation): Promise<void> {
    for (const observer of this.observers) {
      if (!observer.observeOperation) continue;

      await observer.observeOperation(observation);
    }
  }

  /** An operation failed. Errors thrown here are dropped so they never replace the operation's own error. */
  async failed(failure: PlaywrightFailureObservation): Promise<void> {
    for (const observer of this.observers) {
      try { await observer.observeFailure?.(failure); }
      catch { /* The operation's error is the one that counts. */ }
    }
  }
}
