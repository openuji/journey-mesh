import type { JourneyInputAction } from "@openuji/journey-core";
import type {
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyExecutionDescriptor,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-runner";
import type { AppiumConnection, AppiumElement, AppiumSessionOptions } from "./contracts.js";

export type IosDeviceMetrics = Readonly<{ scale?: number; platformVersion?: string }>;

/** iOS XCUITest runtime port. Exposes no Android-only commands such as `clearApplication`. */
export type IosAppiumSession = {
  readonly id: string;
  findElements(xpath: string): Promise<readonly AppiumElement[]>;
  tap(elementId: string): Promise<void>;
  /** Drags one finger downward from the center of the target element; requires vertical room below it. */
  swipeDown(elementId: string): Promise<void>;
  setValue(elementId: string, value: string): Promise<void>;
  source(): Promise<string>;
  screenshot(): Promise<string>;
  deviceMetrics(): Promise<IosDeviceMetrics>;
  activateApplication(bundleId: string): Promise<void>;
  terminateApplication(bundleId: string): Promise<void>;
  openDeepLink(url: string, bundleId: string): Promise<void>;
  close(): Promise<void>;
};

export type IosAppiumSessionFactory = (options: AppiumSessionOptions & AppiumConnection) => Promise<IosAppiumSession>;

export type IosAppiumApplicationConfig = Readonly<{
  app: string;
  bundleId: string;
}>;

export type IosAppiumOperationObservation = Readonly<{ execution: JourneyExecutionDescriptor }> & (
  | Readonly<{
      stage: "state-asserted" | "transition-ready";
      operation: StatePlanOperation | TransitionPlanOperation;
      session: IosAppiumSession;
      targets: readonly AppiumElement[];
      expectedMatchCount: number;
      decision?: InputModalityDecision;
    }>
  | Readonly<{ stage: "transition-completed"; operation: TransitionPlanOperation }>
  | Readonly<{ stage: "control-flow-recorded"; operation: ControlFlowPlanOperation }>
);

export type IosAppiumExecutionObserver = {
  readonly name: string;
  readonly version?: string;
  onExecutionStarted?(input: { readonly execution: JourneyExecutionDescriptor }): Promise<void> | void;
  onAction?(action: JourneyInputAction): Promise<void> | void;
  observeOperation?(observation: IosAppiumOperationObservation): Promise<void> | void;
};
