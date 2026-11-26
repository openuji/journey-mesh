import {
  errorToJourneyRunError,
  type JourneyRunError
} from "../errors.js";
import type { ExecutionResult, RunResult } from "../results/contracts.js";
import type {
  JourneyExecutionDescriptor,
  JourneyObserver,
  JourneyObserverRunStartedInput
} from "./contracts.js";

export class JourneyObserverDispatcher {
  constructor(private readonly journeyObservers: readonly JourneyObserver[]) {}

  async runStarted(
    input: JourneyObserverRunStartedInput
  ): Promise<readonly JourneyRunError[]> {
    return this.started((observer) => observer.onRunStarted?.(input));
  }

  async executionStarted(
    execution: JourneyExecutionDescriptor
  ): Promise<readonly JourneyRunError[]> {
    return this.started((observer) => observer.onExecutionStarted?.({ execution }));
  }

  /** Tells every observer that something starts. One that throws stops neither the others nor the run. */
  private async started(
    notify: (observer: JourneyObserver) => Promise<void> | void
  ): Promise<readonly JourneyRunError[]> {
    const errors: JourneyRunError[] = [];
    for (const observer of this.journeyObservers) {
      try {
        await notify(observer);
      } catch (error) {
        errors.push(errorToJourneyRunError(error));
      }
    }

    return errors;
  }

  async executionCompleted(
    execution: JourneyExecutionDescriptor,
    result: ExecutionResult
  ): Promise<JourneyRunError | undefined> {
    for (const observer of this.journeyObservers) {
      if (!observer.onExecutionCompleted) continue;

      try {
        await observer.onExecutionCompleted({ execution, result });
      } catch (error) {
        return errorToJourneyRunError(error);
      }
    }

    return undefined;
  }

  async runCompleted(result: RunResult): Promise<JourneyRunError | undefined> {
    for (const observer of this.journeyObservers) {
      if (!observer.onRunCompleted) continue;

      try {
        await observer.onRunCompleted({ result });
      } catch (error) {
        return errorToJourneyRunError(error);
      }
    }

    return undefined;
  }
}
