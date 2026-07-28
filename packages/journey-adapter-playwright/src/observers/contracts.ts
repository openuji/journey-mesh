import type {
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyExecutionDescriptor,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-runner";
import type { Locator, Page } from "playwright";

export type PlaywrightObserverExecutionStartedInput = {
  readonly execution: JourneyExecutionDescriptor;
};

export type PlaywrightOperationObservation =
  | {
      readonly stage: "state-asserted";
      readonly execution: JourneyExecutionDescriptor;
      readonly operation: StatePlanOperation;
      readonly page: Page;
      readonly locator: Locator;
      readonly expectedMatchCount: number;
    }
  | {
      readonly stage: "transition-ready";
      readonly execution: JourneyExecutionDescriptor;
      readonly operation: TransitionPlanOperation;
      readonly page: Page;
      readonly locator: Locator;
      readonly expectedMatchCount: 1;
      readonly decision: InputModalityDecision;
    }
  | {
      readonly stage: "control-flow-recorded";
      readonly execution: JourneyExecutionDescriptor;
      readonly operation: ControlFlowPlanOperation;
    };

export type PlaywrightExecutionObserver = {
  readonly name: string;
  readonly version?: string;
  onExecutionStarted?(
    input: PlaywrightObserverExecutionStartedInput
  ): Promise<void> | void;
  observeOperation?(observation: PlaywrightOperationObservation): Promise<void> | void;
};

/**
 * @deprecated Use PlaywrightExecutionObserver.
 */
export type PlaywrightJourneyObserver = PlaywrightExecutionObserver;
