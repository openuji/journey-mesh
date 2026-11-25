import type { JourneyInputAction } from "@openuji/journey-core";
import { type IosJourneyClient } from "@openuji/journey-platform-ios";
import {
  executionDescriptor,
  type JourneyExecutor,
  type JourneyExecutorSession,
  type JourneyExecutorSessionInput,
  type JourneyPlanOperation
} from "@openuji/journey-runner";
import type { AppiumConnection, AppiumDeviceConfig } from "./contracts.js";
import type {
  IosAppiumApplicationConfig,
  IosAppiumExecutionObserver,
  IosAppiumOperationObservation,
  IosAppiumSession,
  IosAppiumSessionFactory
} from "./ios-contracts.js";
import { appiumIosExecutorName } from "./name.js";
import { appiumIosObservationContract } from "./observation-contract.js";
import { appiumCommandForModality, appiumSupportsModality, touchTapInputModalityId, xpathLiteral } from "./queries.js";
import { appiumIosLocatorQuery, appiumIosObservationQuery } from "./ios-queries.js";
import { createIosWebdriverIoSession } from "./ios-session.js";
import { appiumSessionKey } from "./index.js";

export type * from "./ios-contracts.js";
export { appiumIosObservationContract, appiumIosExecutorName, appiumIosLocatorQuery, appiumIosObservationQuery, touchTapInputModalityId, xpathLiteral };

export type IosAppiumLifecycleStatus = "created" | "starting" | "started" | "closing" | "closed";
export type IosAppiumResource = Readonly<{
  id: string;
  kind: "session";
  key: string;
  actorId: string;
  touchpointId: string;
  udid: string;
  session: IosAppiumSession;
}>;
export type IosAppiumLifecycleState = Readonly<{
  status: IosAppiumLifecycleStatus;
  resources: readonly IosAppiumResource[];
  failures: readonly unknown[];
}>;
export type IosAppiumLifecycleEvent =
  | Readonly<{ type: "start" }>
  | Readonly<{ type: "started" }>
  | Readonly<{ type: "register"; resource: IosAppiumResource }>
  | Readonly<{ type: "release"; id: string }>
  | Readonly<{ type: "fail"; error: unknown }>
  | Readonly<{ type: "close" }>
  | Readonly<{ type: "closed" }>;

export function initialIosAppiumLifecycleState(): IosAppiumLifecycleState {
  return freezeLifecycle({ status: "created", resources: [], failures: [] });
}

export function reduceIosAppiumLifecycle(
  state: IosAppiumLifecycleState,
  event: IosAppiumLifecycleEvent
): IosAppiumLifecycleState {
  switch (event.type) {
    case "start":
      requireStatus(state, "created", event.type);
      return freezeLifecycle({ ...state, status: "starting" });
    case "started":
      requireStatus(state, "starting", event.type);
      return freezeLifecycle({ ...state, status: "started" });
    case "register":
      if (state.status !== "starting" && state.status !== "started") throw new Error(`Cannot register Appium iOS resource while ${state.status}`);
      if (state.resources.some((resource) => resource.id === event.resource.id)) throw new Error(`Duplicate Appium iOS resource ${event.resource.id}`);
      return freezeLifecycle({ ...state, resources: [...state.resources, Object.freeze(event.resource)] });
    case "release":
      return freezeLifecycle({ ...state, resources: state.resources.filter((resource) => resource.id !== event.id) });
    case "fail":
      return freezeLifecycle({ ...state, failures: [...state.failures, event.error] });
    case "close":
      if (state.status === "closed" || state.status === "closing") return state;
      return freezeLifecycle({ ...state, status: "closing" });
    case "closed":
      if (state.status === "closed") return state;
      requireStatus(state, "closing", event.type);
      return freezeLifecycle({ ...state, status: "closed", resources: [] });
  }
}

function requireStatus(state: IosAppiumLifecycleState, expected: IosAppiumLifecycleStatus, event: string): void {
  if (state.status !== expected) throw new Error(`Cannot ${event} Appium iOS execution from ${state.status}`);
}

function freezeLifecycle(input: { status: IosAppiumLifecycleStatus; resources: readonly IosAppiumResource[]; failures: readonly unknown[] }): IosAppiumLifecycleState {
  return Object.freeze({ status: input.status, resources: Object.freeze([...input.resources]), failures: Object.freeze([...input.failures]) });
}

export type AppiumIosExecutorOptions = Readonly<{
  client: IosJourneyClient;
  application: IosAppiumApplicationConfig;
  devices: Readonly<Record<string, AppiumDeviceConfig>>;
  connection?: AppiumConnection;
  sessionFactory?: IosAppiumSessionFactory;
  executionObservers?: readonly IosAppiumExecutionObserver[];
  assertionTimeoutMs?: number;
  pollIntervalMs?: number;
  prepare?: (signal?: AbortSignal) => Promise<void>;
  verifyInstallation?: (input: { udid: string; execution: ReturnType<typeof executionDescriptor>; signal?: AbortSignal }) => Promise<void>;
}>;

export function validateAppiumIosOperation(operation: JourneyPlanOperation): void {
  if (operation.kind === "state") {
    if (!Number.isInteger(operation.target.expectedMatchCount) || operation.target.expectedMatchCount < 0) {
      throw new Error(`Invalid native match count ${operation.target.expectedMatchCount}`);
    }
    appiumIosObservationQuery(operation.target.bindings);
  } else if (operation.kind === "transition") {
    if (operation.activation.requiredInputModalityProfiles.length > 0) {
      appiumIosObservationQuery(operation.activation.bindings);
    }
    for (const materialization of operation.materializations ?? []) {
      if (appiumSupportsModality(materialization.modality.id)) {
        throw new Error(`Transition ${operation.transition.id}: Appium iOS does not perform TransitionMaterialization ${materialization.id} (${materialization.modality.id}) yet`);
      }
    }
  }
}

export function appiumIosExecutor(options: AppiumIosExecutorOptions): JourneyExecutor {
  const configured = freezeOptions(options);
  return Object.freeze({
    name: appiumIosExecutorName,
    version: "0.1.0",
    describeOperation(operation) {
      if (!configured.devices[operation.touchpointId]) throw new Error(`No Appium iOS device for touchpoint ${operation.touchpointId}`);
      validateAppiumIosOperation(operation);
      return Object.freeze({ name: appiumIosExecutorName, version: "0.1.0" });
    },
    createSession: (input) => new AppiumIosExecution(input, configured)
  });
}

class AppiumIosExecution implements JourneyExecutorSession {
  private actionSequence = 0;
  private state: IosAppiumLifecycleState = initialIosAppiumLifecycleState();
  private readonly execution;

  constructor(
    private readonly input: JourneyExecutorSessionInput,
    private readonly options: AppiumIosExecutorOptions
  ) {
    this.execution = executionDescriptor(input.context);
  }

  async start(): Promise<void> {
    this.state = reduceIosAppiumLifecycle(this.state, { type: "start" });
    try {
      await this.options.prepare?.(this.input.context.signal);
      this.input.context.signal?.throwIfAborted();
      for (const observer of this.options.executionObservers ?? []) {
        await observer.onExecutionStarted?.({ execution: this.execution });
      }
      this.input.context.signal?.throwIfAborted();
      this.state = reduceIosAppiumLifecycle(this.state, { type: "started" });
    } catch (error) {
      this.state = reduceIosAppiumLifecycle(this.state, { type: "fail", error });
      throw error;
    }
  }

  async openEntry(operation: JourneyPlanOperation): Promise<void> {
    const session = await this.sessionForOperation(operation);
    const target = this.options.client.resolveEntry(operation);
    this.input.context.signal?.throwIfAborted();
    if (target.kind === "application") {
      await session.activateApplication(this.options.application.bundleId);
    } else {
      await session.openDeepLink(target.url, this.options.application.bundleId);
    }
    this.input.context.signal?.throwIfAborted();
  }

  async assertState(operation: Parameters<JourneyExecutorSession["assertState"]>[0]): Promise<void> {
    const query = appiumIosObservationQuery(operation.target.bindings);
    const session = await this.sessionForOperation(operation);
    const targets = await this.assertCount(session, query, operation.target.expectedMatchCount);
    await this.observe({ execution: this.execution, stage: "state-asserted", operation, session, targets, expectedMatchCount: operation.target.expectedMatchCount });
  }

  async performTransition(...[operation, decision]: Parameters<JourneyExecutorSession["performTransition"]>): Promise<void> {
    this.requireStarted();
    if (!decision) {
      if (operation.activation.requiredInputModalityProfiles.length > 0) {
        throw new Error(`Transition ${operation.transition.id} requires an input modality decision`);
      }
      await this.observe({ execution: this.execution, stage: "transition-completed", operation });
      return;
    }
    if (decision.materialization) {
      throw new Error(`Transition ${operation.transition.id}: Appium iOS does not perform TransitionMaterialization ${decision.materialization.id} yet`);
    }
    const command = appiumCommandForModality(decision.modality.id);
    const query = appiumIosObservationQuery(operation.activation.bindings);
    const session = await this.sessionForOperation(operation);
    const targets = await this.assertCount(session, query, 1);
    await this.observe({ execution: this.execution, stage: "transition-ready", operation, session, targets, decision, expectedMatchCount: 1 });
    this.input.context.signal?.throwIfAborted();
    const action: JourneyInputAction = Object.freeze({
      id: `${this.execution.executionId}/action/${this.actionSequence++}`,
      runId: this.execution.runId,
      executionId: this.execution.executionId,
      profileId: this.execution.profile.id,
      operationId: operation.id,
      modalityId: decision.modality.id,
      command,
      unit: "adapter-command",
      status: "attempted"
    });
    const notify = async (event: JourneyInputAction) => {
      for (const observer of this.options.executionObservers ?? []) await observer.onAction?.(Object.freeze(event));
    };
    const text = command === "type" ? this.options.client.resolveTransitionValue(operation) : undefined;
    if (command === "type" && !text) throw new Error(`Transition ${operation.transition.id} requires a text value`);
    await notify(action);
    try {
      if (command === "tap") await session.tap(targets[0]!.elementId);
      else await session.setValue(targets[0]!.elementId, text!);
    } catch (error) {
      await notify({ ...action, status: "failed", error: { name: error instanceof Error ? error.name : "Error", message: String(error) } });
      throw error;
    }
    await notify({ ...action, status: "completed" });
    this.input.context.signal?.throwIfAborted();
  }

  async recordControlFlow(operation: Parameters<JourneyExecutorSession["recordControlFlow"]>[0]): Promise<void> {
    this.requireStarted();
    await this.observe({ execution: this.execution, stage: "control-flow-recorded", operation });
  }

  async close(_input: Parameters<JourneyExecutorSession["close"]>[0]): Promise<void> {
    if (this.state.status === "closed" || this.state.status === "closing") return;
    const snapshot = this.state.resources;
    this.state = reduceIosAppiumLifecycle(this.state, { type: "close" });
    let cleanupFailures: readonly unknown[] = Object.freeze([]);
    for (const resource of [...snapshot].reverse()) {
      try { await resource.session.close(); }
      catch (error) {
        cleanupFailures = Object.freeze([...cleanupFailures, error]);
        this.state = reduceIosAppiumLifecycle(this.state, { type: "fail", error });
      }
    }
    this.state = reduceIosAppiumLifecycle(this.state, { type: "closed" });
    if (cleanupFailures.length) {
      throw new AggregateError(cleanupFailures, `Appium iOS cleanup failed: ${cleanupFailures.map(message).join("; ")}`);
    }
  }

  private async sessionForOperation(operation: JourneyPlanOperation): Promise<IosAppiumSession> {
    this.requireStarted();
    const key = appiumSessionKey(operation);
    const existing = this.state.resources.find((resource) => resource.key === key);
    if (existing) return existing.session;
    const device = this.options.devices[operation.touchpointId];
    if (!device) throw new Error(`No Appium iOS device for touchpoint ${operation.touchpointId}`);
    if (this.state.resources.some((resource) => resource.udid === device.udid)) {
      throw new Error(`Appium iOS device ${device.udid} is already allocated to another actor/touchpoint session`);
    }
    const session = await (this.options.sessionFactory ?? createIosWebdriverIoSession)({
      ...this.options.connection,
      capabilities: {
        ...(device.capabilities ?? {}),
        "appium:udid": device.udid,
        "appium:app": this.options.application.app,
        "appium:bundleId": this.options.application.bundleId,
        "appium:noReset": false,
        "appium:fullReset": true,
        "appium:language": "en",
        "appium:locale": "en_US",
        "appium:newCommandTimeout": 300,
        "appium:wdaLaunchTimeout": 120_000,
        "appium:autoAcceptAlerts": true,
        "appium:settings[defaultActiveApplication]": "auto",
        "appium:settings[keyboardWaitTimeout]": 5000
      }
    });
    const resource: IosAppiumResource = Object.freeze({
      id: `session:${key}`,
      kind: "session",
      key,
      actorId: operation.actorId,
      touchpointId: operation.touchpointId,
      udid: device.udid,
      session
    });
    await this.registerAllocated(resource);
    await this.options.verifyInstallation?.({ udid: device.udid, execution: this.execution, signal: this.input.context.signal });
    return session;
  }

  private async registerAllocated(resource: IosAppiumResource): Promise<void> {
    let registered = false;
    try {
      this.input.context.signal?.throwIfAborted();
      this.state = reduceIosAppiumLifecycle(this.state, { type: "register", resource });
      registered = true;
      this.input.context.signal?.throwIfAborted();
    } catch (error) {
      try { await resource.session.close(); }
      catch (cleanupFailure) { this.state = reduceIosAppiumLifecycle(this.state, { type: "fail", error: cleanupFailure }); }
      if (registered) this.state = reduceIosAppiumLifecycle(this.state, { type: "release", id: resource.id });
      throw error;
    }
  }

  private async assertCount(session: IosAppiumSession, query: string, expected: number) {
    if (!Number.isInteger(expected) || expected < 0) throw new Error(`Invalid native match count ${expected}`);
    const deadline = Date.now() + (this.options.assertionTimeoutMs ?? 30_000);
    do {
      this.input.context.signal?.throwIfAborted();
      await dismissIosPlatformInterruption(session);
      const found = await session.findElements(query);
      const unique = Object.freeze(found.filter((item, index) => found.findIndex((other) => other.elementId === item.elementId) === index));
      if (unique.length === expected) return unique;
      if (Date.now() >= deadline) throw new Error(`Native iOS locator expected ${expected} matches, found ${unique.length}: ${query}`);
      await new Promise((resolve) => setTimeout(resolve, this.options.pollIntervalMs ?? 250));
    } while (true);
  }

  private async observe(observation: IosAppiumOperationObservation): Promise<void> {
    for (const observer of this.options.executionObservers ?? []) {
      this.input.context.signal?.throwIfAborted();
      await observer.observeOperation?.(observation);
    }
  }

  private requireStarted(): void {
    this.input.context.signal?.throwIfAborted();
    if (this.state.status !== "started") throw new Error(`Appium iOS execution is not started (${this.state.status})`);
  }
}

async function dismissIosPlatformInterruption(session: IosAppiumSession): Promise<void> {
  const query = "//XCUIElementTypeAlert//XCUIElementTypeButton[@label='Allow' or @label='Allow While Using App' or @label='Continue' or @label='Not Now'] | //XCUIElementTypeSheet//XCUIElementTypeButton[@label='Not Now'] | //XCUIElementTypeButton[@label='Not Now' and @visible='true']";
  const prompts = await session.findElements(query);
  if (prompts.length === 1) {
    try { await session.tap(prompts[0]!.elementId); }
    catch (error) {
      if (!(error instanceof Error) || error.name !== "stale element reference") throw error;
    }
  }
}

function freezeOptions(options: AppiumIosExecutorOptions): AppiumIosExecutorOptions {
  const application = Object.freeze({ ...options.application });
  const connection = options.connection ? Object.freeze({ ...options.connection }) : undefined;
  const devices = Object.freeze(Object.fromEntries(Object.entries(options.devices).map(([id, device]) => [id, Object.freeze({
    ...device,
    ...(device.capabilities ? { capabilities: deepFreeze(structuredClone(device.capabilities)) } : {})
  })])));
  if (!application.bundleId) throw new Error("Appium iOS requires bundleId configuration");
  if (!Object.keys(devices).length) throw new Error("Appium iOS requires at least one device");
  for (const [touchpoint, device] of Object.entries(devices)) if (!device.udid) throw new Error(`Appium iOS device for ${touchpoint} has no UDID`);
  const udids = Object.values(devices).map((device) => device.udid);
  if (new Set(udids).size !== udids.length) throw new Error("Each touchpoint needs its own Appium iOS device");
  if (!application.app) throw new Error("Appium iOS requires an app bundle path");
  return Object.freeze({
    ...options,
    application,
    devices,
    ...(connection ? { connection } : {}),
    executionObservers: Object.freeze([...(options.executionObservers ?? [])])
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
