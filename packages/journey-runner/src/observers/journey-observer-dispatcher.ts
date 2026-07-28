import {
  errorToJourneyRunError,
  type JourneyRunError
} from "../errors.js";
import type { ExecutionResult, RunResult } from "../index.js";
import type {
  JourneyExecutionDescriptor,
  JourneyObserver,
  JourneyObserverRunStartedInput
} from "./contracts.js";

export class JourneyObserverDispatcher {
  constructor(private readonly journeyObservers: readonly JourneyObserver[]) {}

  async runStarted(
    input: JourneyObserverRunStartedInput
  ): Promise<JourneyRunError | undefined> {
    for (const observer of this.journeyObservers) {
      if (!observer.onRunStarted) continue;

      try {
        await observer.onRunStarted(input);
      } catch (error) {
        return errorToJourneyRunError(error);
      }
    }

    return undefined;
  }

  async executionStarted(
    execution: JourneyExecutionDescriptor
  ): Promise<void> {
    for (const observer of this.journeyObservers) {
      if (!observer.onExecutionStarted) continue;

      await observer.onExecutionStarted({ execution });
    }
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
