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

/** What a failed check compared with the page: something the model declares. */
export type PlaywrightCheck =
  /** The objects a State's ObservationBinding names, in the expected number. */
  | Readonly<{ kind: "state" }>
  /** The one object the Transition's ObservationBinding names. */
  | Readonly<{ kind: "target" }>
  /** Where a materialization starts (`materializationStartLocatorRef`). */
  | Readonly<{ kind: "start"; materializationId: string }>
  /** The check of one step (Operability §7). */
  | Readonly<{ kind: "step"; materializationId: string; stepId: string }>
  /** Text entry: the Transition's object has focus. */
  | Readonly<{ kind: "entry"; materializationId?: string }>;

/**
 * A check of an operation failed while its page was open, observed before the error propagates. Other
 * failures, such as a missing key setting, are not observed. The executor ignores observer errors
 * here: the operation's own error is what fails.
 */
export type PlaywrightFailureObservation = {
  readonly stage: "operation-failed";
  readonly execution: JourneyExecutionDescriptor;
  readonly operation: StatePlanOperation | TransitionPlanOperation;
  readonly page: Page;
  readonly error: Readonly<{ name: string; message: string }>;
  readonly check: PlaywrightCheck;
  /** The executor command that failed, when the failure was inside one. */
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
