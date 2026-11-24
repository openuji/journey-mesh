import type { JourneyInputAction } from "@openuji/journey-core";
import { type AndroidJourneyClient } from "@openuji/journey-platform-android";
import {
  executionDescriptor,
  type JourneyExecutor,
  type JourneyExecutorSession,
  type JourneyExecutorSessionInput,
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
import { appiumCommandForModality, appiumObservationQuery, appiumSupportsModality } from "./queries.js";
import { createWebdriverIoSession } from "./session.js";
import {
  initialAppiumLifecycleState,
  reduceAppiumLifecycle,
  type AppiumLifecycleState,
  type AppiumResource
} from "./lifecycle.js";

export type * from "./contracts.js";
export { appiumAndroidObservationContract } from "./observation-contract.js";
export { appiumServerContract, type AppiumServer } from "./server.js";
export { appiumCommandForModality, appiumLocatorQuery, appiumObservationQuery, touchTapInputModalityId, xpathLiteral } from "./queries.js";
export type { AppiumInteractionCommand } from "./queries.js";
export { initialAppiumLifecycleState, reduceAppiumLifecycle } from "./lifecycle.js";
export type { AppiumLifecycleEvent, AppiumLifecycleState, AppiumLifecycleStatus, AppiumResource } from "./lifecycle.js";
export const appiumExecutorName = "@openuji/journey-executor-appium";

export type AppiumExecutorOptions = Readonly<{
  client: AndroidJourneyClient;
  application: AppiumApplicationConfig;
  devices: Readonly<Record<string, AppiumDeviceConfig>>;
  connection?: AppiumConnection;
  sessionFactory?: AppiumSessionFactory;
  executionObservers?: readonly AppiumExecutionObserver[];
  assertionTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Idempotent APK materialization/checksum verification, with no configuration overrides. */
  prepare?: (signal?: AbortSignal) => Promise<void>;
  /** Local installation evidence is collected before the first modeled interaction on each device. */
  verifyInstallation?: (input: { udid: string; execution: ReturnType<typeof executionDescriptor>; signal?: AbortSignal }) => Promise<void>;
  preserveApkSignature?: boolean;
}>;

export function validateAppiumOperation(operation: JourneyPlanOperation): void {
  if (operation.kind === "state") {
    if (!Number.isInteger(operation.target.expectedMatchCount) || operation.target.expectedMatchCount < 0) throw new Error(`Invalid native match count ${operation.target.expectedMatchCount}`);
    appiumObservationQuery(operation.target.bindings);
  } else if (operation.kind === "transition") {
    if (operation.activation.requiredInputModalityProfiles.length > 0) appiumObservationQuery(operation.activation.bindings);
    // Declared step chains are not performed natively yet; refuse them rather than tap past them.
    for (const materialization of operation.materializations ?? []) {
      if (appiumSupportsModality(materialization.modality.id)) {
        throw new Error(`Transition ${operation.transition.id}: Appium does not perform TransitionMaterialization ${materialization.id} (${materialization.modality.id}) yet`);
      }
    }
  }
}

export function appiumSessionKey(operation: JourneyPlanOperation): string {
  return JSON.stringify([operation.actorId, operation.touchpointId]);
}

export function appiumExecutor(options: AppiumExecutorOptions): JourneyExecutor {
  const configured = freezeOptions(options);
  return Object.freeze({
    name: appiumExecutorName,
    version: "0.1.0",
    describeOperation(operation) {
      if (!configured.devices[operation.touchpointId]) throw new Error(`No Appium device for touchpoint ${operation.touchpointId}`);
      validateAppiumOperation(operation);
      return Object.freeze({ name: appiumExecutorName, version: "0.1.0" });
    },
    createSession: (input) => new AppiumExecution(input, configured)
  });
}

class AppiumExecution implements JourneyExecutorSession {
  private actionSequence = 0;
  private state: AppiumLifecycleState = initialAppiumLifecycleState();
  private readonly execution;

  constructor(
    private readonly input: JourneyExecutorSessionInput,
    private readonly options: AppiumExecutorOptions
  ) {
    this.execution = executionDescriptor(input.context);
  }

  async start(): Promise<void> {
    this.state = reduceAppiumLifecycle(this.state, { type: "start" });
    try {
      await this.options.prepare?.(this.input.context.signal);
      this.input.context.signal?.throwIfAborted();
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
    const target = this.options.client.resolveEntry(operation);
    this.input.context.signal?.throwIfAborted();
    if (target.kind === "application") {
      await session.activateApplication(this.options.application.package);
    } else await session.openDeepLink(target.url, this.options.application.package);
    this.input.context.signal?.throwIfAborted();
  }

  async assertState(operation: Parameters<JourneyExecutorSession["assertState"]>[0]): Promise<void> {
    const query = appiumObservationQuery(operation.target.bindings);
    const session = await this.sessionForOperation(operation);
    const targets = await this.assertCount(session, query, operation.target.expectedMatchCount);
    await this.observe({ execution: this.execution, stage: "state-asserted", operation, session, targets, expectedMatchCount: operation.target.expectedMatchCount });
  }

  async performTransition(...[operation, decision]: Parameters<JourneyExecutorSession["performTransition"]>): Promise<void> {
    this.requireStarted();
    if (!decision) {
      if (operation.activation.requiredInputModalityProfiles.length > 0) throw new Error(`Transition ${operation.transition.id} requires an input modality decision`);
      await this.observe({ execution: this.execution, stage: "transition-completed", operation });
      return;
    }
    if (decision.materialization) {
      throw new Error(`Transition ${operation.transition.id}: Appium does not perform TransitionMaterialization ${decision.materialization.id} yet`);
    }
    const command = appiumCommandForModality(decision.modality.id);
    const query = appiumObservationQuery(operation.activation.bindings);
    const session = await this.sessionForOperation(operation);
    const targets = await this.assertCount(session, query, 1);
    await this.observe({ execution: this.execution, stage: "transition-ready", operation, session, targets, decision, expectedMatchCount: 1 });
    this.input.context.signal?.throwIfAborted();
    const action: JourneyInputAction = Object.freeze({
      id: `${this.execution.executionId}/action/${this.actionSequence++}`,
      runId: this.execution.runId, executionId: this.execution.executionId,
      profileId: this.execution.profile.id, operationId: operation.id,
      modalityId: decision.modality.id, command, unit: "adapter-command", status: "attempted"
    });
    const notify = async (event: JourneyInputAction) => {
      for (const observer of this.options.executionObservers ?? []) await observer.onAction?.(Object.freeze(event));
    };
    // Resolve text before announcing an actual command attempt.
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
    this.state = reduceAppiumLifecycle(this.state, { type: "close" });
    let cleanupFailures: readonly unknown[] = Object.freeze([]);
    for (const resource of [...snapshot].reverse()) {
      try { await resource.session.close(); }
      catch (error) {
        cleanupFailures = Object.freeze([...cleanupFailures, error]);
        this.state = reduceAppiumLifecycle(this.state, { type: "fail", error });
      }
    }
    this.state = reduceAppiumLifecycle(this.state, { type: "closed" });
    if (cleanupFailures.length) {
      throw new AggregateError(cleanupFailures, `Appium cleanup failed: ${cleanupFailures.map(message).join("; ")}`);
    }
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
        ...(this.options.preserveApkSignature ? { "appium:noSign": true } : {}),
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
    await this.options.verifyInstallation?.({ udid: device.udid, execution: this.execution, signal: this.input.context.signal });
    // Chrome custom-tab state is executor-owned runtime preconditioning.
    await session.terminateApplication("com.android.chrome", 5_000);
    await session.clearApplication("com.android.chrome");
    return session;
  }

  private async registerAllocated(resource: AppiumResource): Promise<void> {
    let registered = false;
    try {
      this.input.context.signal?.throwIfAborted();
      this.state = reduceAppiumLifecycle(this.state, { type: "register", resource });
      registered = true;
      this.input.context.signal?.throwIfAborted();
    } catch (error) {
      try { await resource.session.close(); }
      catch (cleanupFailure) { this.state = reduceAppiumLifecycle(this.state, { type: "fail", error: cleanupFailure }); }
      if (registered) this.state = reduceAppiumLifecycle(this.state, { type: "release", id: resource.id });
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
  if (prompts.length === 1) {
    try { await session.tap(prompts[0]!.elementId); }
    catch (error) {
      // Chrome or Android can dismiss the prompt between lookup and tap.
      // Continue with the modeled state check; other command failures stay fatal.
      if (!(error instanceof Error) || error.name !== "stale element reference") throw error;
    }
  }
}

function freezeOptions(options: AppiumExecutorOptions): AppiumExecutorOptions {
  const application = Object.freeze({ ...options.application });
  const connection = options.connection ? Object.freeze({ ...options.connection }) : undefined;
  const devices = Object.freeze(Object.fromEntries(Object.entries(options.devices).map(([id, device]) => [id, Object.freeze({
    ...device,
    ...(device.capabilities ? { capabilities: deepFreeze(structuredClone(device.capabilities)) } : {})
  })])));
  if (!application.package || !application.activity) throw new Error("Appium requires package and activity configuration");
  if (!Object.keys(devices).length) throw new Error("Appium requires at least one device");
  for (const [touchpoint, device] of Object.entries(devices)) if (!device.udid) throw new Error(`Appium device for ${touchpoint} has no UDID`);
  const udids = Object.values(devices).map((device) => device.udid);
  if (new Set(udids).size !== udids.length) throw new Error("Each touchpoint needs its own Appium device");
  if (!application.apk) throw new Error("Appium requires an APK");
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
