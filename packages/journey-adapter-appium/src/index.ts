import { type AndroidJourneyDriver } from "@openuji/journey-driver-android";
import {
  executionDescriptor,
  type JourneyAdapter,
  type JourneyAdapterExecution,
  type JourneyAdapterExecutionInput,
  type JourneyPlanOperation
} from "@openuji/journey-runner";
import type {
  AppiumApplicationConfig,
  AppiumConnection,
  AppiumDeviceConfig,
  AppiumExecutionObserver,
  AppiumOperationObservation,
  AppiumSession,
  AppiumSessionFactory
} from "./contracts.js";
import { appiumCommandForModality, appiumObservationQuery } from "./queries.js";
import { createWebdriverIoSession } from "./session.js";
import {
  initialAppiumLifecycleState,
  reduceAppiumLifecycle,
  type AppiumLifecycleState,
  type AppiumResource
} from "./lifecycle.js";

export type * from "./contracts.js";
export { appiumCommandForModality, appiumLocatorQuery, appiumObservationQuery, touchTapInputModalityId, xpathLiteral } from "./queries.js";
export type { AppiumInteractionCommand } from "./queries.js";
export { initialAppiumLifecycleState, reduceAppiumLifecycle } from "./lifecycle.js";
export type { AppiumLifecycleEvent, AppiumLifecycleState, AppiumLifecycleStatus, AppiumResource } from "./lifecycle.js";
export const appiumAdapterName = "@openuji/journey-adapter-appium";

export type AppiumAdapterOptions = Readonly<{
  driver: AndroidJourneyDriver;
  application: AppiumApplicationConfig;
  devices: Readonly<Record<string, AppiumDeviceConfig>>;
  connection?: AppiumConnection;
  sessionFactory?: AppiumSessionFactory;
  executionObservers?: readonly AppiumExecutionObserver[];
  assertionTimeoutMs?: number;
  pollIntervalMs?: number;
}>;

export function appiumSessionKey(operation: JourneyPlanOperation): string {
  return JSON.stringify([operation.actorId, operation.touchpointId]);
}

export function appiumAdapter(options: AppiumAdapterOptions): JourneyAdapter {
  const configured = freezeOptions(options);
  return Object.freeze({
    name: appiumAdapterName,
    version: "0.1.0",
    describeOperation(operation) {
      if (!configured.devices[operation.touchpointId]) throw new Error(`No Appium device for touchpoint ${operation.touchpointId}`);
      if (operation.kind === "state") {
        if (!Number.isInteger(operation.target.expectedMatchCount) || operation.target.expectedMatchCount < 0) {
          throw new Error(`Invalid native match count ${operation.target.expectedMatchCount}`);
        }
        appiumObservationQuery(operation.target.bindings);
      } else if (operation.kind === "transition" && operation.activation.requiredInputModalityProfiles.length > 0) {
        appiumObservationQuery(operation.activation.bindings);
      }
      return Object.freeze({ name: appiumAdapterName, version: "0.1.0" });
    },
    createExecution: (input) => new AppiumExecution(input, configured)
  });
}

class AppiumExecution implements JourneyAdapterExecution {
  private state: AppiumLifecycleState = initialAppiumLifecycleState();
  private readonly execution;

  constructor(
    private readonly input: JourneyAdapterExecutionInput,
    private readonly options: AppiumAdapterOptions
  ) {
    this.execution = executionDescriptor(input.context);
  }

  async start(): Promise<void> {
    this.state = reduceAppiumLifecycle(this.state, { type: "start" });
    try {
      for (const observer of this.options.executionObservers ?? []) {
        await observer.onExecutionStarted?.({ execution: this.execution });
      }
      this.input.context.signal?.throwIfAborted();
      this.state = reduceAppiumLifecycle(this.state, { type: "started" });
    } catch (error) {
      this.state = reduceAppiumLifecycle(this.state, { type: "fail", error });
      throw error;
    }
  }

  async openEntry(operation: JourneyPlanOperation): Promise<void> {
    const session = await this.sessionForOperation(operation);
    const target = this.options.driver.resolveEntry(operation);
    this.input.context.signal?.throwIfAborted();
    if (target.kind === "application") {
      // Enter from a deterministic stopped process. Merely activating an
      // already-foreground app is a no-op and can leave server-backed state
      // stale between composed journeys.
      await session.terminateApplication(this.options.application.package, 5_000);
      this.input.context.signal?.throwIfAborted();
      await session.activateApplication(this.options.application.package);
    } else await session.openDeepLink(target.url, this.options.application.package);
    this.input.context.signal?.throwIfAborted();
  }

  async assertState(operation: Parameters<JourneyAdapterExecution["assertState"]>[0]): Promise<void> {
    const query = appiumObservationQuery(operation.target.bindings);
    const session = await this.sessionForOperation(operation);
    const targets = await this.assertCount(session, query, operation.target.expectedMatchCount);
    await this.observe({ execution: this.execution, stage: "state-asserted", operation, session, targets, expectedMatchCount: operation.target.expectedMatchCount });
  }

  async performTransition(...[operation, decision]: Parameters<JourneyAdapterExecution["performTransition"]>): Promise<void> {
    this.requireStarted();
    if (!decision) {
      if (operation.activation.requiredInputModalityProfiles.length > 0) throw new Error(`Transition ${operation.transition.id} requires an input modality decision`);
      await this.observe({ execution: this.execution, stage: "transition-completed", operation });
      return;
    }
    const command = appiumCommandForModality(decision.modality.id);
    const query = appiumObservationQuery(operation.activation.bindings);
    const session = await this.sessionForOperation(operation);
    const targets = await this.assertCount(session, query, 1);
    await this.observe({ execution: this.execution, stage: "transition-ready", operation, session, targets, decision, expectedMatchCount: 1 });
    this.input.context.signal?.throwIfAborted();
    switch (command) {
      case "tap": await session.tap(targets[0]!.elementId); break;
      case "type": {
        const value = this.options.driver.resolveTransitionValue(operation);
        if (!value) throw new Error(`Transition ${operation.transition.id} requires a text value`);
        await session.setValue(targets[0]!.elementId, value);
        break;
      }
    }
    this.input.context.signal?.throwIfAborted();
  }

  async recordControlFlow(operation: Parameters<JourneyAdapterExecution["recordControlFlow"]>[0]): Promise<void> {
    this.requireStarted();
    await this.observe({ execution: this.execution, stage: "control-flow-recorded", operation });
  }

  async close(_input: Parameters<JourneyAdapterExecution["close"]>[0]): Promise<void> {
    if (this.state.status === "closed" || this.state.status === "closing") return;
    const snapshot = this.state.resources;
    this.state = reduceAppiumLifecycle(this.state, { type: "close" });
    const priorFailures = this.state.failures;
    let cleanupFailures: readonly unknown[] = Object.freeze([]);
    for (const resource of [...snapshot].reverse()) {
      try { await resource.session.close(); }
      catch (error) {
        cleanupFailures = Object.freeze([...cleanupFailures, error]);
        this.state = reduceAppiumLifecycle(this.state, { type: "fail", error });
      }
    }
    this.state = reduceAppiumLifecycle(this.state, { type: "closed" });
    const failures = [...priorFailures, ...cleanupFailures];
    if (failures.length) throw new AggregateError(failures, `Appium cleanup failed: ${failures.map(message).join("; ")}`);
  }

  private async sessionForOperation(operation: JourneyPlanOperation): Promise<AppiumSession> {
    this.requireStarted();
    const key = appiumSessionKey(operation);
    const existing = this.state.resources.find((resource) => resource.key === key);
    if (existing) return existing.session;
    const device = this.options.devices[operation.touchpointId];
    if (!device) throw new Error(`No Appium device for touchpoint ${operation.touchpointId}`);
    if (this.state.resources.some((resource) => resource.udid === device.udid)) {
      throw new Error(`Appium device ${device.udid} is already allocated to another actor/touchpoint session`);
    }
    const session = await (this.options.sessionFactory ?? createWebdriverIoSession)({
      ...this.options.connection,
      capabilities: {
        ...(device.capabilities ?? {}),
        "appium:udid": device.udid,
        "appium:app": this.options.application.apk,
        "appium:appPackage": this.options.application.package,
        "appium:appActivity": this.options.application.activity,
        "appium:noReset": false,
        "appium:fullReset": true,
        "appium:autoGrantPermissions": true,
        "appium:language": "en",
        "appium:locale": "US",
        "appium:newCommandTimeout": 180
      }
    });
    const resource: AppiumResource = Object.freeze({
      id: `session:${key}`,
      kind: "session",
      key,
      actorId: operation.actorId,
      touchpointId: operation.touchpointId,
      udid: device.udid,
      session
    });
    await this.registerAllocated(resource);
    // Chrome custom-tab state is adapter-owned runtime preconditioning.
    await session.terminateApplication("com.android.chrome", 5_000);
    await session.clearApplication("com.android.chrome");
    return session;
  }

  private async registerAllocated(resource: AppiumResource): Promise<void> {
    try {
      this.input.context.signal?.throwIfAborted();
      this.state = reduceAppiumLifecycle(this.state, { type: "register", resource });
      this.input.context.signal?.throwIfAborted();
    } catch (error) {
      try { await resource.session.close(); }
      catch (cleanupFailure) { this.state = reduceAppiumLifecycle(this.state, { type: "fail", error: cleanupFailure }); }
      this.state = reduceAppiumLifecycle(this.state, { type: "release", id: resource.id });
      throw error;
    }
  }

  private async assertCount(session: AppiumSession, query: string, expected: number) {
    if (!Number.isInteger(expected) || expected < 0) throw new Error(`Invalid native match count ${expected}`);
    const deadline = Date.now() + (this.options.assertionTimeoutMs ?? 30_000);
    do {
      this.input.context.signal?.throwIfAborted();
      await dismissPlatformInterruption(session);
      const found = await session.findElements(query);
      const unique = Object.freeze(found.filter((item, index) => found.findIndex((other) => other.elementId === item.elementId) === index));
      if (unique.length === expected) return unique;
      if (Date.now() >= deadline) throw new Error(`Native locator expected ${expected} matches, found ${unique.length}: ${query}`);
      await new Promise((resolve) => setTimeout(resolve, this.options.pollIntervalMs ?? 250));
    } while (true);
  }

  private async observe(observation: AppiumOperationObservation): Promise<void> {
    for (const observer of this.options.executionObservers ?? []) {
      this.input.context.signal?.throwIfAborted();
      await observer.observeOperation?.(observation);
    }
  }

  private requireStarted(): void {
    this.input.context.signal?.throwIfAborted();
    if (this.state.status !== "started") throw new Error(`Appium execution is not started (${this.state.status})`);
  }
}

async function dismissPlatformInterruption(session: AppiumSession): Promise<void> {
  const query = "//*[@resource-id='com.android.permissioncontroller:id/permission_allow_button' or @resource-id='com.android.chrome:id/signin_fre_dismiss_button' or @resource-id='com.android.chrome:id/terms_accept' or @resource-id='com.android.chrome:id/ack_button' or @resource-id='com.android.chrome:id/negative_button']";
  const prompts = await session.findElements(query);
  if (prompts.length === 1) await session.tap(prompts[0]!.elementId);
}

function freezeOptions(options: AppiumAdapterOptions): AppiumAdapterOptions {
  const application = Object.freeze({ ...options.application });
  const connection = options.connection ? Object.freeze({ ...options.connection }) : undefined;
  const devices = Object.freeze(Object.fromEntries(Object.entries(options.devices).map(([id, device]) => [id, Object.freeze({
    ...device,
    ...(device.capabilities ? { capabilities: deepFreeze(structuredClone(device.capabilities)) } : {})
  })])));
  if (!application.apk || !application.package || !application.activity) throw new Error("Appium requires APK, package, and activity configuration");
  if (!Object.keys(devices).length) throw new Error("Appium requires at least one device");
  for (const [id, device] of Object.entries(devices)) if (!device.udid) throw new Error(`Appium device ${id} requires a UDID`);
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
