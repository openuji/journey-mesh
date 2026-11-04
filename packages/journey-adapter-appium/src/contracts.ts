import type {
  ControlFlowPlanOperation, InputModalityDecision, JourneyExecutionContext,
  JourneyExecutionDescriptor, JourneyPlanOperation, StatePlanOperation, TransitionPlanOperation
} from "@openuji/journey-runner";

export type AppiumElement = Readonly<{ elementId: string }>;
export type AndroidDeviceMetrics = Readonly<{ densityDpi?: number; platformVersion?: string }>;

/** Runtime port. Handles never enter runner results or observer evidence. */
export type AppiumSession = {
  readonly id: string;
  findElements(xpath: string): Promise<readonly AppiumElement[]>;
  tap(elementId: string): Promise<void>;
  setValue(elementId: string, value: string): Promise<void>;
  source(): Promise<string>;
  screenshot(): Promise<string>;
  deviceMetrics(): Promise<AndroidDeviceMetrics>;
  execute(command: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
  close(): Promise<void>;
};

export type AppiumConnection = Readonly<{
  hostname?: string;
  port?: number;
  path?: string;
  protocol?: "http" | "https";
}>;
export type AppiumSessionOptions = Readonly<{
  capabilities: Readonly<Record<string, unknown>>;
}>;
export type AppiumSessionFactory = (
  options: AppiumSessionOptions & AppiumConnection
) => Promise<AppiumSession>;

export type AppiumDriverExecutionContext = JourneyExecutionContext & {
  createSession(options: AppiumSessionOptions): Promise<AppiumSession>;
};
export type AppiumJourneyDriver = {
  readonly name: string;
  readonly version?: string;
  createExecution(input: { readonly context: AppiumDriverExecutionContext }): AppiumJourneyDriverExecution;
};
export type AppiumJourneyDriverExecution = {
  start(): Promise<void> | void;
  openEntry(operation: JourneyPlanOperation): Promise<void> | void;
  sessionForOperation(operation: JourneyPlanOperation): Promise<AppiumSession> | AppiumSession;
  afterTransition(operation: TransitionPlanOperation, decision?: InputModalityDecision): Promise<void> | void;
  recordControlFlow(operation: ControlFlowPlanOperation): Promise<void> | void;
  close(input: { readonly executionFailed: boolean }): Promise<void> | void;
};

export type AppiumOperationObservation = Readonly<{ execution: JourneyExecutionDescriptor }> & (
  | Readonly<{
      stage: "state-asserted" | "transition-ready";
      operation: StatePlanOperation | TransitionPlanOperation;
      session: AppiumSession;
      targets: readonly AppiumElement[];
      expectedMatchCount: number;
      decision?: InputModalityDecision;
    }>
  | Readonly<{ stage: "transition-completed"; operation: TransitionPlanOperation }>
  | Readonly<{ stage: "control-flow-recorded"; operation: ControlFlowPlanOperation }>
);

export type AppiumExecutionObserver = {
  readonly name: string;
  readonly version?: string;
  onExecutionStarted?(input: { readonly execution: JourneyExecutionDescriptor }): Promise<void> | void;
  observeOperation?(observation: AppiumOperationObservation): Promise<void> | void;
};
