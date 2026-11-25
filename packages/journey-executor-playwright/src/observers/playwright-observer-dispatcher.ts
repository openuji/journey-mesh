import type { JourneyInputAction } from "@openuji/journey-core";
import type { JourneyExecutionDescriptor } from "@openuji/journey-runner";

import type {
  PlaywrightExecutionObserver,
  PlaywrightFailureObservation,
  PlaywrightOperationObservation
} from "./contracts.js";

export class PlaywrightObserverDispatcher {
  /** Errors an observer threw: they fail the operation, but the application did not fail. */
  private readonly observerErrors = new WeakSet<object>();

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
    await this.marking(async () => {
      for (const observer of this.observers) await observer.onAction?.(Object.freeze({ ...action }));
    });
  }

  async observe(observation: PlaywrightOperationObservation): Promise<void> {
    await this.marking(async () => {
      for (const observer of this.observers) {
        if (!observer.observeOperation) continue;

        await observer.observeOperation(observation);
      }
    });
  }

  /**
   * An operation failed. Observer errors are dropped so they never replace the operation's own error,
   * and a failure an observer caused is not passed on: it says nothing about the application.
   */
  async failed(failure: PlaywrightFailureObservation, cause: unknown): Promise<void> {
    if (cause && typeof cause === "object" && this.observerErrors.has(cause)) return;
    for (const observer of this.observers) {
      try { await observer.observeFailure?.(failure); }
      catch { /* The operation's error is the one that counts. */ }
    }
  }

  private async marking(work: () => Promise<void>): Promise<void> {
    try { await work(); }
    catch (error) {
      if (error && typeof error === "object") this.observerErrors.add(error);
      throw error;
    }
  }
}
