import type {
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyExecutionDescriptor,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-runner";

export type AppiumElement = Readonly<{ elementId: string }>;
export type AndroidDeviceMetrics = Readonly<{ densityDpi?: number; platformVersion?: string }>;

/** Runtime port. Raw mobile command execution is intentionally not public. */
export type AppiumSession = {
  readonly id: string;
  findElements(xpath: string): Promise<readonly AppiumElement[]>;
  tap(elementId: string): Promise<void>;
  setValue(elementId: string, value: string): Promise<void>;
  source(): Promise<string>;
  screenshot(): Promise<string>;
  deviceMetrics(): Promise<AndroidDeviceMetrics>;
  activateApplication(applicationId: string): Promise<void>;
  terminateApplication(applicationId: string, timeoutMs?: number): Promise<void>;
  clearApplication(applicationId: string): Promise<void>;
  openDeepLink(url: string, applicationId: string): Promise<void>;
  close(): Promise<void>;
};

export type AppiumConnection = Readonly<{
  hostname?: string;
  port?: number;
  path?: string;
  protocol?: "http" | "https";
}>;
export type AppiumSessionOptions = Readonly<{ capabilities: Readonly<Record<string, unknown>> }>;
export type AppiumSessionFactory = (options: AppiumSessionOptions & AppiumConnection) => Promise<AppiumSession>;

export type AppiumApplicationConfig = Readonly<{
  apk: string;
  package: string;
  activity: string;
}>;
export type AppiumDeviceConfig = Readonly<{
  udid: string;
  capabilities?: Readonly<Record<string, unknown>>;
}>;

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
