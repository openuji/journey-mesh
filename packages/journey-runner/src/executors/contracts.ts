import type {
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyPlan,
  JourneyPlanOperation,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";
import type { JourneyComponentDescriptor } from "../observers/contracts.js";

/** Runner-owned context. Automation handles stay inside executor executions. */
export type JourneyExecutionContext = {
  readonly runId: string;
  readonly executionId: string;
  readonly profile: JourneyProfile;
  readonly plan: JourneyPlan;
  readonly signal?: AbortSignal;
};

/** @deprecated Use JourneyExecutionContext. */
export type ExecutorSessionContext = JourneyExecutionContext;

export type JourneyExecutorCloseInput = {
  readonly executionFailed: boolean;
};

/**
 * Runtime-neutral boundary implemented by browser, native, or other executors.
 * Each profile receives a new execution; executor factories may be reused.
 */
export type JourneyExecutor = {
  readonly name: string;
  readonly version?: string;
  /** Describe the child before setup; may reject unsupported model targets without allocating handles. */
  describeOperation?(operation: JourneyPlanOperation): JourneyComponentDescriptor;
  createSession(input: JourneyExecutorSessionInput): JourneyExecutorSession;
};

export type JourneyExecutorSessionInput = {
  readonly context: JourneyExecutionContext;
};

/**
 * start may allocate runtime resources. close must release them even after a
 * partially failed start, and must tolerate repeated calls. Operations arrive
 * in plan order. A missing decision denotes a transition with no declared input;
 * it must not be replaced with a default UI action. Shared fixtures and service
 * effect verification can be supplied through the runner's environment hooks.
 */
export type JourneyExecutorSession = {
  start(): Promise<void> | void;
  openEntry(operation: JourneyPlanOperation): Promise<void> | void;
  assertState(operation: StatePlanOperation): Promise<void> | void;
  performTransition(
    operation: TransitionPlanOperation,
    decision?: InputModalityDecision
  ): Promise<void> | void;
  recordControlFlow(operation: ControlFlowPlanOperation): Promise<void> | void;
  close(input: JourneyExecutorCloseInput): Promise<void> | void;
};

export type JourneyProfile = {
  id: string;
  label?: string;
  /** A false result excludes the profile in preflight; no execution is started. */
  appliesTo?(
    operation: JourneyPlanOperation,
    context: JourneyExecutionContext
  ): Promise<boolean> | boolean;
  /** Required only when a transition declares input modality profiles. */
  selectInputModality?(
    operation: TransitionPlanOperation,
    context: JourneyExecutionContext
  ): Promise<InputModalityDecision> | InputModalityDecision;
};
