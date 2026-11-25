import type { JourneyInputAction } from "@openuji/journey-core";
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
      /** A no-input transition completed without resolving a UI target. */
      readonly stage: "transition-completed";
      readonly execution: JourneyExecutionDescriptor;
      readonly operation: TransitionPlanOperation;
    }
  | {
      readonly stage: "control-flow-recorded";
      readonly execution: JourneyExecutionDescriptor;
      readonly operation: ControlFlowPlanOperation;
    };

/**
 * An operation failed while its page was open, observed before the error propagates. The executor
 * ignores observer errors here: the operation's own error is what fails. A failure that an observer
 * caused (by throwing from `observeOperation`) is not observed as one.
 */
export type PlaywrightFailureObservation = {
  readonly stage: "operation-failed";
  readonly execution: JourneyExecutionDescriptor;
  readonly operation: StatePlanOperation | TransitionPlanOperation;
  readonly page: Page;
  readonly error: Readonly<{ name: string; message: string }>;
  /** The step that failed, when the failure was inside one. */
  readonly action?: JourneyInputAction;
};

export type PlaywrightExecutionObserver = {
  readonly name: string;
  readonly version?: string;
  onExecutionStarted?(
    input: PlaywrightObserverExecutionStartedInput
  ): Promise<void> | void;
  onAction?(action: JourneyInputAction): Promise<void> | void;
  observeOperation?(observation: PlaywrightOperationObservation): Promise<void> | void;
  observeFailure?(failure: PlaywrightFailureObservation): Promise<void> | void;
};

/**
 * @deprecated Use PlaywrightExecutionObserver.
 */
export type PlaywrightJourneyObserver = PlaywrightExecutionObserver;
