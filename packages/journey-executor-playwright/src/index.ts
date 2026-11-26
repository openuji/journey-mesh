import { playwrightExecutorName } from "./name.js";
import type { JourneyInputAction } from "@openuji/journey-core";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type BrowserType,
  type LaunchOptions,
  type Page
} from "playwright";
import { type WebJourneyClient } from "@openuji/journey-platform-web";
import { isCanonical, keyboardTextEntryInputModalityId } from "@openuji/journey-execution-model";
import {
  MaterializationFailedError,
  executionDescriptor,
  fallbackApplies,
  type InputModalityDecision,
  type JourneyExecutor,
  type JourneyExecutorCloseInput,
  type JourneyExecutorSession,
  type JourneyExecutorSessionInput,
  type JourneyExecutionContext,
  type JourneyExecutionDescriptor,
  type JourneyPlanOperation,
  type StatePlanOperation,
  type TransitionPlanOperation
} from "@openuji/journey-runner";
import { ensureChromiumInstalled } from "./browser-binary.js";
import type { PlaywrightExecutionObserver } from "./observers/contracts.js";
import { PlaywrightObserverDispatcher } from "./observers/playwright-observer-dispatcher.js";
import { defaultPlaywrightKeyboard, type PlaywrightKeyboard } from "./keyboard.js";
import { type PlaywrightTransientUi } from "./transient.js";
import { PlaywrightPathFinder, discoverTransition, type PlaywrightDiscovery } from "./discovery.js";
import { assertPlaywrightLocator, toPlaywrightObservationLocator, validatePlaywrightBindings } from "./locators.js";
import {
  PlaywrightCheckError,
  PlaywrightStepPerformer,
  playwrightPerformsModality,
  validatePlaywrightMaterializations,
  type PlaywrightCommandRecorder,
  type PlaywrightPointerState
} from "./materialization.js";
import {
  initialPlaywrightLifecycleState,
  reducePlaywrightLifecycle,
  type PlaywrightLifecycleState,
  type PlaywrightResource
} from "./lifecycle.js";

export { playwrightObservationContract } from "./observation-contract.js";
export { PlaywrightPathFinder, boundLocator, discoverTransition } from "./discovery.js";
export type { DiscoverTransitionInput, PlaywrightDiscovery, PlaywrightFoundPath, PlaywrightPathFinderOptions } from "./discovery.js";
export { defaultPlaywrightKeyboard, parsePlaywrightKeyboard, resolveKey } from "./keyboard.js";
export type { PlaywrightKeyBinding, PlaywrightKeyboard } from "./keyboard.js";
export { noPlaywrightTransientUi, parsePlaywrightTransientUi, playwrightTransientUiPresent } from "./transient.js";
export type { PlaywrightTransientObject, PlaywrightTransientUi } from "./transient.js";
export {
  assertPlaywrightLocator,
  toPlaywrightLocator,
  toPlaywrightObservationLocator,
  validatePlaywrightBindings,
  validatePlaywrightLocator
} from "./locators.js";
export type { LocatorRoot } from "./locators.js";
export {
  PlaywrightStepPerformer,
  playwrightPerformsModality,
  playwrightShortcutExtension,
  validatePlaywrightMaterializations
} from "./materialization.js";
export type {
  PlaywrightCommandRecorder,
  PlaywrightPointerState,
  PlaywrightRecordedCommand,
  PlaywrightStepCommand,
  PlaywrightStepPerformerOptions
} from "./materialization.js";
export {
  initialPlaywrightLifecycleState,
  reducePlaywrightLifecycle
} from "./lifecycle.js";
export type {
  PlaywrightLifecycleEvent,
  PlaywrightLifecycleState,
  PlaywrightLifecycleStatus,
  PlaywrightResource
} from "./lifecycle.js";
export type {
  PlaywrightExecutionObserver,
  PlaywrightFailureObservation,
  PlaywrightJourneyObserver,
  PlaywrightObserverExecutionStartedInput,
  PlaywrightOperationObservation
} from "./observers/contracts.js";
export type PlaywrightExecutorOptions = Readonly<{
  client: WebJourneyClient;
  executionObservers?: readonly PlaywrightExecutionObserver[];
  browser?: Browser;
  headless?: boolean;
  launchOptions?: LaunchOptions;
  contextOptions?: BrowserContextOptions;
  browserType?: Pick<BrowserType, "launch">;
  assertionTimeoutMs?: number;
  actionTimeoutMs?: number;
  navigationTimeoutMs?: number;
  /** Keys for Operability move kinds and activation; defaults to defaultPlaywrightKeyboard. */
  keyboard?: PlaywrightKeyboard;
  /** Interface that expires on its own (toasts); focus walks start only once none is present. */
  transientUi?: PlaywrightTransientUi;
}>;

type PlaywrightSession = Readonly<{
  key: string;
  context: BrowserContext;
  page: Page;
}>;

const defaultAssertionTimeoutMs = 30_000;

export { playwrightExecutorName };

export function playwrightSessionKey(operation: JourneyPlanOperation): string {
  return JSON.stringify([operation.actorId, operation.touchpointId]);
}

export function playwrightExecutor(options: PlaywrightExecutorOptions): JourneyExecutor {
  return createPlaywrightExecutor(options);
}

/**
 * The executor in discovery mode, for `journey-mesh discover` only: a transition without a declared
 * materialization is reached by a measured walk instead of failing, taken, and reported. A test run
 * uses `playwrightExecutor`, which never discovers.
 */
export function playwrightDiscoveryExecutor(options: PlaywrightExecutorOptions, discovery: PlaywrightDiscovery): JourneyExecutor {
  return createPlaywrightExecutor(options, discovery);
}

function createPlaywrightExecutor(options: PlaywrightExecutorOptions, discovery?: PlaywrightDiscovery): JourneyExecutor {
  const configured = freezePlaywrightOptions(options);
  return Object.freeze({
    name: playwrightExecutorName,
    version: "0.1.0",
    describeOperation(operation) {
      if (operation.kind === "state") validatePlaywrightBindings(operation.target.bindings);
      if (operation.kind === "transition" && operation.activation.requiredInputModalityProfiles.length) {
        validatePlaywrightBindings(operation.activation.bindings);
      }
      if (operation.kind === "transition") validatePlaywrightMaterializations(operation, configured.keyboard ?? defaultPlaywrightKeyboard);
      return Object.freeze({ name: playwrightExecutorName, version: "0.1.0" });
    },
    createSession(input) {
      return new PlaywrightExecutorSession(input, configured, discovery);
    }
  });
}

function freezePlaywrightOptions(options: PlaywrightExecutorOptions): PlaywrightExecutorOptions {
  return Object.freeze({
    ...options,
    ...(options.launchOptions ? { launchOptions: freezeConfigValue(options.launchOptions) } : {}),
    ...(options.contextOptions ? { contextOptions: freezeConfigValue(options.contextOptions) } : {}),
    executionObservers: Object.freeze([...(options.executionObservers ?? [])])
  });
}

function freezeConfigValue<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeConfigValue)) as T;
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, freezeConfigValue(item)])
    )) as T;
  }
  return value;
}

class PlaywrightExecutorSession implements JourneyExecutorSession {
  private actionSequence = 0;
  /** The step that failed in the transition being performed, for its failure observation. */
  private failedAction: JourneyInputAction | undefined;
  /** How many inputs this session has sent to a page. */
  private inputsSent = 0;
  /** Discovery only: the transition whose canonical materialization failed after sending input. */
  private changedOperationId: string | undefined;
  private readonly pointers = new WeakMap<Page, PlaywrightPointerState>();
  private state: PlaywrightLifecycleState = initialPlaywrightLifecycleState();
  private readonly context: JourneyExecutionContext;
  private readonly execution: JourneyExecutionDescriptor;
  private readonly observers: PlaywrightObserverDispatcher;

  constructor(
    input: JourneyExecutorSessionInput,
    private readonly options: PlaywrightExecutorOptions,
    /** Set only by `playwrightDiscoveryExecutor`. */
    private readonly discovery?: PlaywrightDiscovery
  ) {
    this.context = input.context;
    this.execution = executionDescriptor(input.context);
    this.observers = new PlaywrightObserverDispatcher(options.executionObservers ?? [], this.execution);
  }

  async start(): Promise<void> {
    this.state = reducePlaywrightLifecycle(this.state, { type: "start" });
    try {
      await this.observers.executionStarted();
      const browser = this.options.browser ?? await launchBrowser(this.options);
      const resource = Object.freeze({
        id: "browser",
        kind: "browser" as const,
        value: browser,
        ...(this.options.browser ? {} : { close: () => browser.close() })
      });
      await this.registerAllocated(resource);
      this.context.signal?.throwIfAborted();
      this.state = reducePlaywrightLifecycle(this.state, { type: "started" });
    } catch (error) {
      this.state = reducePlaywrightLifecycle(this.state, { type: "fail", error });
      throw error;
    }
  }

  async openEntry(operation: JourneyPlanOperation): Promise<void> {
    this.requireStarted();
    const target = this.options.client.resolveEntry(operation);
    const session = await this.sessionForOperation(operation);
    this.context.signal?.throwIfAborted();
    await session.page.goto(target.url, { waitUntil: "domcontentloaded" });
    this.context.signal?.throwIfAborted();
  }

  async assertState(operation: StatePlanOperation): Promise<void> {
    const page = (await this.sessionForOperation(operation)).page;
    try {
      const locator = await toPlaywrightObservationLocator(page, operation.target.bindings);
      await assertPlaywrightLocator(locator, operation.target.expectedMatchCount, {
        timeoutMs: this.options.assertionTimeoutMs ?? defaultAssertionTimeoutMs,
        signal: this.context.signal
      });
      this.context.signal?.throwIfAborted();
      await this.observers.observe({
        execution: this.execution,
        expectedMatchCount: operation.target.expectedMatchCount,
        locator,
        operation,
        page,
        stage: "state-asserted"
      });
    } catch (error) {
      await this.observeFailure(operation, page, error);
      throw error;
    }
  }

  /**
   * Performs the declared materialization the profile selected, step by step. Keyboard and pointer
   * transitions have no other path. Producer text entry types at the current focus after its
   * optional focus moves. Whether the transition was taken is checked by the next State operation.
   */
  async performTransition(
    operation: TransitionPlanOperation,
    decision?: InputModalityDecision
  ): Promise<void> {
    this.requireStarted();
    if (!decision) {
      if (operation.activation.requiredInputModalityProfiles.length > 0) {
        throw new Error(`Transition ${operation.transition.id} requires an input modality decision`);
      }
      await this.observers.observe({ execution: this.execution, operation, stage: "transition-completed" });
      return;
    }
    const modalityId = decision.modality.id;
    if (!playwrightPerformsModality(modalityId)) throw new Error(`Playwright executor does not support input modality ${modalityId}`);
    const textEntry = modalityId === keyboardTextEntryInputModalityId;
    const materialization = decision.materialization;
    if (materialization && materialization.modality.id !== modalityId) {
      throw new Error(`Transition ${operation.transition.id}: materialization ${materialization.id} is through ${materialization.modality.id}, not the selected ${modalityId}`);
    }
    const discovery = this.discovery;
    // Rediscovery measures a new path where the model declares one; a test run never does. The canonical
    // materialization is the expectation, so it is performed, and after it changed the page no path
    // measured from there would stand for the one beside it.
    const measure = discovery?.rediscover === true && !(materialization && isCanonical(materialization))
      && this.changedOperationId !== operation.id;
    const declared = measure ? undefined : materialization;
    if (!declared && !textEntry && !discovery) {
      throw new Error(`Transition ${operation.transition.id}: Playwright performs ${modalityId} only through a declared TransitionMaterialization, and the profile selected none`);
    }
    const page = (await this.sessionForOperation(operation)).page;
    this.failedAction = undefined;
    try {
      await this.performAt({ page, operation, decision, modalityId, textEntry, materialization, declared, discovery });
    } catch (error) {
      await this.observeFailure(operation, page, error, this.failedAction);
      throw error;
    }
  }

  /** The part of `performTransition` that runs on the page, so a failure there is observed with it. */
  private async performAt({ page, operation, decision, modalityId, textEntry, materialization, declared, discovery }: Readonly<{
    page: Page;
    operation: TransitionPlanOperation;
    decision: InputModalityDecision;
    modalityId: string;
    textEntry: boolean;
    materialization: InputModalityDecision["materialization"];
    declared: InputModalityDecision["materialization"];
    discovery: PlaywrightDiscovery | undefined;
  }>): Promise<void> {
    const locator = await toPlaywrightObservationLocator(page, operation.activation.bindings);
    await assertPlaywrightLocator(locator, 1, {
      timeoutMs: this.options.assertionTimeoutMs ?? defaultAssertionTimeoutMs,
      signal: this.context.signal
    });
    this.context.signal?.throwIfAborted();
    await this.observers.observe({
      execution: this.execution,
      decision,
      expectedMatchCount: 1,
      locator,
      operation,
      page,
      stage: "transition-ready"
    });
    const text = textEntry ? this.options.client.resolveTransitionValue(operation) : undefined;
    if (textEntry && !text) throw new Error(`Transition ${operation.transition.id}: text entry requires a transition text value`);
    this.context.signal?.throwIfAborted();
    const performerOptions = {
      page,
      keyboard: this.options.keyboard ?? defaultPlaywrightKeyboard,
      transientUi: this.options.transientUi,
      pointer: this.pointerState(page),
      record: (command: Parameters<PlaywrightCommandRecorder>[0], work: Parameters<PlaywrightCommandRecorder>[1]) => this.recordCommand(operation, decision, command, work),
      timeoutMs: this.options.assertionTimeoutMs ?? defaultAssertionTimeoutMs,
      signal: this.context.signal
    };
    const performer = new PlaywrightStepPerformer(performerOptions);
    const discover = (found: PlaywrightDiscovery, replaces?: string) => discoverTransition({
      operation, decision, target: locator, ...(text ? { text } : {}), discovery: found, performer,
      finder: new PlaywrightPathFinder(performerOptions, found),
      ...(replaces ? { replaces } : {})
    });
    if (discovery && !declared) {
      await discover(discovery, materialization?.id);
      this.context.signal?.throwIfAborted();
      return;
    }
    const finding = discovery ? {
      profileId: decision.profileId, operationId: operation.id, transitionId: operation.transition.id,
      ...(operation.transition.label ? { transitionLabel: operation.transition.label } : {}),
      modalityId
    } : undefined;
    const sentBefore = this.inputsSent;
    try {
      if (declared) await performer.perform(declared);
      if (textEntry) await performer.typeAtFocus(locator, text!, `Transition ${operation.transition.id}`, declared?.id);
    } catch (thrown) {
      // Only a failed check fails the materialization; the runner needs to know whether input was sent.
      const error = declared && thrown instanceof PlaywrightCheckError
        ? new MaterializationFailedError(thrown.message, this.inputsSent !== sentBefore, { cause: thrown })
        : thrown;
      if (!discovery || !declared || !isCanonical(declared) || !MaterializationFailedError.is(error) || this.context.signal?.aborted) throw error;
      if (error.sentInput) this.changedOperationId = operation.id;
      // A declared materialization beside the canonical one is the runner's to perform, where it may.
      if (decision.fallback && fallbackApplies(decision.fallback, error.sentInput)) throw error;
      if (error.sentInput) {
        await discovery.record({ ...finding!, status: "not-found", note: `the canonical materialization ${declared.id} failed after it sent input, so no path can be measured from here: ${error.message}` });
        throw error;
      }
      await discover(discovery);
      this.context.signal?.throwIfAborted();
      return;
    }
    if (discovery) await discovery.record({ ...finding!, status: "declared" });
    this.context.signal?.throwIfAborted();
  }

  private async recordCommand(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision,
    command: Parameters<PlaywrightCommandRecorder>[0],
    work: Parameters<PlaywrightCommandRecorder>[1]
  ): Promise<void> {
    let gesture: string | undefined;
    const action: JourneyInputAction = Object.freeze({
      id: `${this.execution.executionId}/action/${this.actionSequence++}`,
      runId: this.execution.runId, executionId: this.execution.executionId,
      profileId: this.execution.profile.id, operationId: operation.id,
      modalityId: decision.modality.id, command: command.command,
      ...(command.materializationId ? { materializationId: command.materializationId } : {}),
      ...(command.stepId ? { stepId: command.stepId } : {}),
      unit: "adapter-command", status: "attempted"
    });
    await this.observers.action(action);
    try {
      // A step reports its gesture right before it sends it.
      await work((value) => { gesture = value; this.inputsSent++; });
    } catch (error) {
      const failed: JourneyInputAction = Object.freeze({
        ...action, ...(gesture ? { gesture } : {}), status: "failed",
        error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) }
      });
      this.failedAction = failed;
      await this.observers.action(failed);
      throw error;
    }
    await this.observers.action({ ...action, ...(gesture ? { gesture } : {}), status: "completed" });
    this.context.signal?.throwIfAborted();
  }

  /** Lets observers see the page of a failed operation before the runner closes it. */
  private async observeFailure(
    operation: StatePlanOperation | TransitionPlanOperation,
    page: Page,
    error: unknown,
    action?: JourneyInputAction
  ): Promise<void> {
    if (this.context.signal?.aborted || page.isClosed()) return;
    await this.observers.failed({
      stage: "operation-failed", execution: this.execution, operation, page,
      error: Object.freeze({ name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) }),
      ...(action ? { action } : {})
    });
  }

  private pointerState(page: Page): PlaywrightPointerState {
    const existing = this.pointers.get(page);
    if (existing) return existing;
    const created: PlaywrightPointerState = {};
    this.pointers.set(page, created);
    return created;
  }

  async recordControlFlow(operation: Parameters<JourneyExecutorSession["recordControlFlow"]>[0]): Promise<void> {
    this.requireStarted();
    await this.observers.observe({ execution: this.execution, operation, stage: "control-flow-recorded" });
  }

  async close(_input: JourneyExecutorCloseInput): Promise<void> {
    if (this.state.status === "closed" || this.state.status === "closing") return;
    const snapshot = this.state.resources;
    this.state = reducePlaywrightLifecycle(this.state, { type: "close" });
    let cleanupFailures: readonly unknown[] = Object.freeze([]);
    for (const resource of [...snapshot].reverse()) {
      if (!resource.close) continue;
      try { await resource.close(); }
      catch (error) {
        cleanupFailures = Object.freeze([...cleanupFailures, error]);
        this.state = reducePlaywrightLifecycle(this.state, { type: "fail", error });
      }
    }
    this.state = reducePlaywrightLifecycle(this.state, { type: "closed" });
    if (cleanupFailures.length) throw cleanupError("Playwright", cleanupFailures);
  }

  private async sessionForOperation(operation: JourneyPlanOperation): Promise<PlaywrightSession> {
    this.requireStarted();
    const key = playwrightSessionKey(operation);
    const existing = this.state.resources.find((resource) => resource.kind === "session" && resource.id === `session:${key}`);
    if (existing) return existing.value as PlaywrightSession;
    const browser = this.browser();
    let contextOptions = this.options.contextOptions;
    if (contextOptions?.recordHar) {
      // Closing a context writes its HAR. A shared path lets a later profile
      // (or another actor) replace the evidence from an earlier failure.
      const { path, ...recordHar } = contextOptions.recordHar;
      const scope = createHash("sha256").update(JSON.stringify([this.execution.runId, this.execution.executionId, key])).digest("hex").slice(0, 16);
      const extension = extname(path);
      contextOptions = { ...contextOptions, recordHar: { ...recordHar, path: join(dirname(path), `${basename(path, extension)}.${scope}${extension}`) } };
    }
    const context = await browser.newContext(contextOptions);
    await this.registerAllocated(Object.freeze({
      id: `context:${key}`,
      kind: "context" as const,
      value: context,
      close: () => context.close()
    }));
    if (this.options.actionTimeoutMs) context.setDefaultTimeout(this.options.actionTimeoutMs);
    if (this.options.navigationTimeoutMs) context.setDefaultNavigationTimeout(this.options.navigationTimeoutMs);
    const page = await context.newPage();
    const session = Object.freeze({ key, context, page });
    await this.registerAllocated(Object.freeze({
      id: `session:${key}`,
      kind: "session" as const,
      value: session,
      close: () => page.close()
    }));
    return session;
  }

  private async registerAllocated(resource: PlaywrightResource): Promise<void> {
    let registered = false;
    try {
      this.context.signal?.throwIfAborted();
      this.state = reducePlaywrightLifecycle(this.state, { type: "register", resource });
      registered = true;
      this.context.signal?.throwIfAborted();
    } catch (error) {
      try { await resource.close?.(); }
      catch (cleanupFailure) {
        this.state = reducePlaywrightLifecycle(this.state, { type: "fail", error: cleanupFailure });
      }
      if (registered) this.state = reducePlaywrightLifecycle(this.state, { type: "release", id: resource.id });
      throw error;
    }
  }

  private browser(): Browser {
    const resource = this.state.resources.find((candidate) => candidate.kind === "browser");
    if (!resource) throw new Error("Playwright execution has no browser");
    return resource.value as Browser;
  }

  private requireStarted(): void {
    this.context.signal?.throwIfAborted();
    if (this.state.status !== "started") {
      throw new Error(`Playwright executor execution ${this.context.executionId} is not started (${this.state.status})`);
    }
  }
}

async function launchBrowser(options: PlaywrightExecutorOptions): Promise<Browser> {
  // Only the default chromium target is known here; a caller-supplied
  // browserType may point at a browser whose binary this package can't
  // install on its behalf.
  if (!options.browserType) await ensureChromiumInstalled();
  return (options.browserType ?? chromium).launch({ headless: options.headless ?? true, ...options.launchOptions });
}

function cleanupError(runtime: string, failures: readonly unknown[]): AggregateError {
  return new AggregateError(
    failures,
    `${runtime} cleanup failed: ${failures.map((error) => error instanceof Error ? error.message : String(error)).join("; ")}`
  );
}
