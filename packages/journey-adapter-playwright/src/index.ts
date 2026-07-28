import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type BrowserType,
  type LaunchOptions,
  type Locator,
  type Page
} from "playwright";

import type {
  AccessibleFeature,
  AdapterExecutionContext,
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyAdapter,
  JourneyInteractionCommand,
  JourneyObserver,
  JourneyPlanOperation,
  JsonObject,
  ResolvedAccessibleLocator,
  ResolvedObservationBinding,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-runner";
import { errorToEvidence } from "@openuji/journey-runner";

export type PlaywrightCreateBrowserContextInput = {
  operation?: JourneyPlanOperation;
  label?: string;
  data?: JsonObject;
};

export type PlaywrightArtifactMode = "off" | "retain-on-failure" | "always";

export type PlaywrightArtifactAttachment = {
  path?: string;
  body?: string | Buffer;
  contentType?: string;
};

export type PlaywrightArtifactSink = {
  outputPath(...pathSegments: string[]): string;
  attach(name: string, attachment: PlaywrightArtifactAttachment): Promise<void> | void;
};

export type PlaywrightArtifactOptions = {
  mode?: PlaywrightArtifactMode;
  sink?: PlaywrightArtifactSink;
  traces?: boolean;
  screenshots?: boolean;
  videos?: boolean;
};

export type PlaywrightDriverExecutionContext = AdapterExecutionContext & {
  browser: Browser;
  createBrowserContext(
    input?: PlaywrightCreateBrowserContextInput
  ): Promise<BrowserContext>;
};

export type PlaywrightTransitionValueInput = {
  operation: TransitionPlanOperation;
  context: PlaywrightDriverExecutionContext;
};

export type PlaywrightJourneyDriver = {
  name: string;
  version?: string;
  setupExecution(context: PlaywrightDriverExecutionContext): Promise<void> | void;
  openEntry(
    operation: JourneyPlanOperation,
    context: PlaywrightDriverExecutionContext
  ): Promise<void> | void;
  pageForOperation(
    operation: JourneyPlanOperation,
    context: PlaywrightDriverExecutionContext
  ): Promise<Page> | Page;
  transitionValue(
    input: PlaywrightTransitionValueInput
  ): Promise<string | undefined> | string | undefined;
  afterTransition(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision,
    context: PlaywrightDriverExecutionContext
  ): Promise<void> | void;
  recordControlFlow(
    operation: ControlFlowPlanOperation,
    context: PlaywrightDriverExecutionContext
  ): Promise<void> | void;
  teardownExecution(context: PlaywrightDriverExecutionContext): Promise<void> | void;
};

export type PlaywrightOperationObservation =
  | {
      stage: "state-asserted";
      operation: StatePlanOperation;
      context: PlaywrightDriverExecutionContext;
      page: Page;
      locator: Locator;
      expectedMatchCount: number;
    }
  | {
      stage: "transition-ready";
      operation: TransitionPlanOperation;
      context: PlaywrightDriverExecutionContext;
      page: Page;
      locator: Locator;
      expectedMatchCount: 1;
      decision: InputModalityDecision;
    }
  | {
      stage: "control-flow-recorded";
      operation: ControlFlowPlanOperation;
      context: PlaywrightDriverExecutionContext;
    };

export type PlaywrightJourneyObserver = JourneyObserver & {
  observePlaywrightOperation(
    observation: PlaywrightOperationObservation
  ): Promise<void> | void;
};

export function isPlaywrightJourneyObserver(
  observer: JourneyObserver
): observer is PlaywrightJourneyObserver {
  return typeof (observer as { observePlaywrightOperation?: unknown }).observePlaywrightOperation === "function";
}

export type PlaywrightAdapterOptions = {
  driver: PlaywrightJourneyDriver;
  browser?: Browser;
  headless?: boolean;
  launchOptions?: LaunchOptions;
  contextOptions?: BrowserContextOptions;
  browserType?: Pick<BrowserType, "launch">;
  assertionTimeoutMs?: number;
  artifacts?: PlaywrightArtifactOptions;
};

export type LocatorRoot = Page | Locator;

type LocatorResolutionOptions = {
  driver?: PlaywrightJourneyDriver;
  operation?: JourneyPlanOperation;
  context?: PlaywrightDriverExecutionContext;
};

type AdapterExecutionState = {
  browser: Browser;
  ownsBrowser: boolean;
  context: PlaywrightDriverExecutionContext;
  browserContexts: BrowserContextRecord[];
};

type BrowserContextRecord = {
  id: string;
  label: string;
  browserContext: BrowserContext;
  pages: Set<Page>;
  traceStarted: boolean;
};

type ResolvedArtifactOptions = {
  mode: PlaywrightArtifactMode;
  sink?: PlaywrightArtifactSink;
  traces: boolean;
  screenshots: boolean;
  videos: boolean;
};

const roleOptionFeatureNames = new Set(["expanded"]);
const defaultAssertionTimeoutMs = 30_000;

export function playwrightAdapter(options: PlaywrightAdapterOptions): JourneyAdapter {
  const executions = new Map<string, AdapterExecutionState>();
  const artifactOptions = resolveArtifactOptions(options.artifacts);

  if (artifactOptions.mode !== "off" && !artifactOptions.sink) {
    throw new Error("Playwright artifacts require an artifact sink");
  }

  return {
    name: "@openuji/journey-adapter-playwright",
    version: "0.1.0",

    async setupExecution(context) {
      const browser = options.browser ?? await launchBrowser(options);
      const state: AdapterExecutionState = {
        browser,
        ownsBrowser: !options.browser,
        context: undefined as unknown as PlaywrightDriverExecutionContext,
        browserContexts: []
      };
      const driverContext: PlaywrightDriverExecutionContext = {
        ...context,
        browser,
        createBrowserContext(input) {
          return createTrackedBrowserContext(state, context, options, artifactOptions, input);
        }
      };
      state.context = driverContext;

      executions.set(context.executionId, {
        browser,
        ownsBrowser: state.ownsBrowser,
        context: driverContext,
        browserContexts: state.browserContexts
      });

      context.evidence.emit({
        type: state.ownsBrowser ? "playwright.browser.launched" : "playwright.browser.attached",
        executionId: context.executionId,
        profileId: context.profile.id,
        ok: true,
        data: {
          headless: state.ownsBrowser ? options.headless ?? true : null,
          owned: state.ownsBrowser,
          driver: componentData(options.driver)
        }
      });

      await options.driver.setupExecution(driverContext);
    },

    async openEntry(operation, context) {
      const state = requireExecutionState(executions, context.executionId);
      await options.driver.openEntry(operation, state.context);
    },

    async assertState(operation, context) {
      const state = requireExecutionState(executions, context.executionId);
      const page = await options.driver.pageForOperation(operation, state.context);
      const locator = await toPlaywrightObservationLocator(page, operation.target.bindings, {
        operation,
        context: state.context,
        driver: options.driver
      });

      await assertPlaywrightLocator(locator, operation.target.expectedMatchCount, {
        timeoutMs: options.assertionTimeoutMs ?? defaultAssertionTimeoutMs
      });

      context.evidence.emit({
        type: "playwright.assertion.completed",
        executionId: context.executionId,
        profileId: context.profile.id,
        operationId: operation.id,
        operationKind: operation.kind,
        ok: true,
        ujg: {
          documentId: operation.documentId,
          stateId: operation.state.id,
          surfaceId: operation.surface.id,
          observationBindingIds: operation.target.bindings.map((binding) => binding.id),
          locatorIds: unique(
            operation.target.bindings.flatMap((binding) => collectLocatorIds(binding.locators))
          )
        },
        data: {
          expectedMatchCount: operation.target.expectedMatchCount
        }
      });

      await notifyPlaywrightObservers({
        context: state.context,
        expectedMatchCount: operation.target.expectedMatchCount,
        locator,
        operation,
        page,
        stage: "state-asserted"
      });
    },

    async performTransition(operation, decision, context) {
      const state = requireExecutionState(executions, context.executionId);
      const page = await options.driver.pageForOperation(operation, state.context);
      const locator = await toPlaywrightObservationLocator(page, operation.activation.bindings, {
        operation,
        context: state.context,
        driver: options.driver
      });

      await assertPlaywrightLocator(locator, 1, {
        timeoutMs: options.assertionTimeoutMs ?? defaultAssertionTimeoutMs
      });

      await notifyPlaywrightObservers({
        context: state.context,
        decision,
        expectedMatchCount: 1,
        locator,
        operation,
        page,
        stage: "transition-ready"
      });

      const text = decision.command === "keyboard-text-entry"
        ? await options.driver.transitionValue({ operation, context: state.context })
        : undefined;

      await activatePlaywrightLocator(locator, decision.command, text);
      await options.driver.afterTransition(operation, decision, state.context);

      context.evidence.emit({
        type: "playwright.transition.completed",
        executionId: context.executionId,
        profileId: context.profile.id,
        operationId: operation.id,
        operationKind: operation.kind,
        ok: true,
        ujg: {
          documentId: operation.documentId,
          transitionId: operation.transition.id,
          surfaceId: operation.surface.id,
          observationBindingIds: operation.activation.bindings.map((binding) => binding.id),
          locatorIds: unique(
            operation.activation.bindings.flatMap((binding) => collectLocatorIds(binding.locators))
          )
        },
        data: {
          command: decision.command,
          inputModalityProfileId: decision.inputModalityProfile.id,
          modalityId: decision.modality.id
        }
      });
    },

    async recordControlFlow(operation, context) {
      const state = requireExecutionState(executions, context.executionId);
      await options.driver.recordControlFlow(operation, state.context);
      await notifyPlaywrightObservers({
        context: state.context,
        operation,
        stage: "control-flow-recorded"
      });
    },

    async teardownExecution(context) {
      const state = executions.get(context.executionId);
      if (!state) return;

      const retainArtifacts = shouldRetainArtifacts(context, artifactOptions.mode);

      try {
        await captureScreenshotsAndStopTraces(state, context, artifactOptions, retainArtifacts);
        await options.driver.teardownExecution(state.context);
      } finally {
        await closeTrackedBrowserContexts(state, context);
        await attachVideos(state, context, artifactOptions, retainArtifacts);
        if (state.ownsBrowser) {
          await state.browser.close();
        }
        executions.delete(context.executionId);
        context.evidence.emit({
          type: state.ownsBrowser ? "playwright.browser.closed" : "playwright.browser.released",
          executionId: context.executionId,
          profileId: context.profile.id,
          ok: true
        });
      }
    }
  };
}

async function launchBrowser(options: PlaywrightAdapterOptions): Promise<Browser> {
  const browserType = options.browserType ?? chromium;
  return browserType.launch({
    headless: options.headless ?? true,
    ...options.launchOptions
  });
}

async function createTrackedBrowserContext(
  state: AdapterExecutionState,
  context: AdapterExecutionContext,
  options: PlaywrightAdapterOptions,
  artifactOptions: ResolvedArtifactOptions,
  input: PlaywrightCreateBrowserContextInput = {}
): Promise<BrowserContext> {
  const id = `context-${String(state.browserContexts.length + 1).padStart(2, "0")}`;
  const label = input.label ?? id;
  const browserContextOptions = await browserContextOptionsForArtifacts(options, artifactOptions);
  const browserContext = await state.browser.newContext(browserContextOptions);
  const record: BrowserContextRecord = {
    id,
    label,
    browserContext,
    pages: new Set(browserContext.pages()),
    traceStarted: false
  };

  browserContext.on("page", (page) => {
    record.pages.add(page);
  });

  state.browserContexts.push(record);
  context.evidence.emit({
    type: "playwright.context.created",
    executionId: context.executionId,
    profileId: context.profile.id,
    ok: true,
    data: {
      id,
      label,
      operationId: input.operation?.id ?? null,
      ...(input.data ? { input: input.data } : {})
    }
  });

  if (artifactOptions.mode !== "off" && artifactOptions.traces) {
    await browserContext.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true
    });
    record.traceStarted = true;
    context.evidence.emit({
      type: "playwright.trace.started",
      executionId: context.executionId,
      profileId: context.profile.id,
      ok: true,
      data: { contextId: id, label }
    });
  }

  return browserContext;
}

async function browserContextOptionsForArtifacts(
  options: PlaywrightAdapterOptions,
  artifactOptions: ResolvedArtifactOptions
): Promise<BrowserContextOptions> {
  const contextOptions: BrowserContextOptions = {
    ...options.contextOptions
  };
  if (
    artifactOptions.mode !== "off" &&
    artifactOptions.videos &&
    artifactOptions.sink &&
    !contextOptions.recordVideo
  ) {
    const videoDir = artifactOptions.sink.outputPath("videos");
    await mkdir(videoDir, { recursive: true });
    contextOptions.recordVideo = { dir: videoDir };
  }

  return contextOptions;
}

async function captureScreenshotsAndStopTraces(
  state: AdapterExecutionState,
  context: AdapterExecutionContext,
  artifactOptions: ResolvedArtifactOptions,
  retainArtifacts: boolean
): Promise<void> {
  for (const browserContext of state.browserContexts) {
    if (retainArtifacts && artifactOptions.screenshots) {
      await captureScreenshots(browserContext, context, artifactOptions);
    }

    if (browserContext.traceStarted) {
      await stopTrace(browserContext, context, artifactOptions, retainArtifacts);
    }
  }
}

async function captureScreenshots(
  browserContext: BrowserContextRecord,
  context: AdapterExecutionContext,
  artifactOptions: ResolvedArtifactOptions
): Promise<void> {
  const sink = artifactOptions.sink;
  if (!sink) return;

  const pages = trackedPages(browserContext);
  for (const [index, page] of pages.entries()) {
    const path = sink.outputPath(
      "screenshots",
      `${safePathSegment(context.executionId)}-${safePathSegment(browserContext.label)}-page-${index + 1}.png`
    );
    try {
      await ensureParentDir(path);
      await page.screenshot({ path, fullPage: true });
      await sink.attach(
        `${context.executionId}-${browserContext.label}-page-${index + 1}.png`,
        { path, contentType: "image/png" }
      );
      context.evidence.emit({
        type: "playwright.screenshot.attached",
        executionId: context.executionId,
        profileId: context.profile.id,
        ok: true,
        data: { contextId: browserContext.id, label: browserContext.label, path }
      });
    } catch (error) {
      emitArtifactFailure(context, "playwright.screenshot.failed", error, {
        contextId: browserContext.id,
        label: browserContext.label,
        path
      });
    }
  }
}

async function stopTrace(
  browserContext: BrowserContextRecord,
  context: AdapterExecutionContext,
  artifactOptions: ResolvedArtifactOptions,
  retainArtifacts: boolean
): Promise<void> {
  const sink = artifactOptions.sink;
  const path = retainArtifacts && sink
    ? sink.outputPath(
        "traces",
        `${safePathSegment(context.executionId)}-${safePathSegment(browserContext.label)}.zip`
      )
    : undefined;

  try {
    if (path) {
      await ensureParentDir(path);
      await browserContext.browserContext.tracing.stop({ path });
      await sink?.attach(
        `${context.executionId}-${browserContext.label}-trace.zip`,
        { path, contentType: "application/zip" }
      );
      context.evidence.emit({
        type: "playwright.trace.attached",
        executionId: context.executionId,
        profileId: context.profile.id,
        ok: true,
        data: { contextId: browserContext.id, label: browserContext.label, path }
      });
      return;
    }

    await browserContext.browserContext.tracing.stop();
  } catch (error) {
    emitArtifactFailure(context, "playwright.trace.failed", error, {
      contextId: browserContext.id,
      label: browserContext.label,
      path: path ?? null
    });
  } finally {
    browserContext.traceStarted = false;
  }
}

async function closeTrackedBrowserContexts(
  state: AdapterExecutionState,
  context: AdapterExecutionContext
): Promise<void> {
  await Promise.all(
    state.browserContexts.map(async (record) => {
      try {
        await record.browserContext.close();
      } catch (error) {
        emitArtifactFailure(context, "playwright.context.close.failed", error, {
          contextId: record.id,
          label: record.label
        });
      }
    })
  );
}

async function attachVideos(
  state: AdapterExecutionState,
  context: AdapterExecutionContext,
  artifactOptions: ResolvedArtifactOptions,
  retainArtifacts: boolean
): Promise<void> {
  if (!artifactOptions.videos) return;

  for (const browserContext of state.browserContexts) {
    const pages = trackedPages(browserContext);
    for (const [index, page] of pages.entries()) {
      const video = page.video();
      if (!video) continue;

      try {
        if (!retainArtifacts) {
          await video.delete();
          continue;
        }

        const path = await video.path();
        await artifactOptions.sink?.attach(
          `${context.executionId}-${browserContext.label}-page-${index + 1}.webm`,
          { path, contentType: "video/webm" }
        );
        context.evidence.emit({
          type: "playwright.video.attached",
          executionId: context.executionId,
          profileId: context.profile.id,
          ok: true,
          data: { contextId: browserContext.id, label: browserContext.label, path }
        });
      } catch (error) {
        emitArtifactFailure(context, "playwright.video.failed", error, {
          contextId: browserContext.id,
          label: browserContext.label
        });
      }
    }
  }
}

async function notifyPlaywrightObservers(
  observation: PlaywrightOperationObservation
): Promise<void> {
  const observers = observation.context.observers.filter(isPlaywrightJourneyObserver);

  for (const observer of observers) {
    try {
      observation.context.evidence.emit({
        type: "playwright.observer.operation.started",
        executionId: observation.context.executionId,
        profileId: observation.context.profile.id,
        operationId: observation.operation.id,
        operationKind: observation.operation.kind,
        ok: true,
        data: {
          observer: componentData(observer),
          stage: observation.stage
        }
      });
      await observer.observePlaywrightOperation(observation);
      observation.context.evidence.emit({
        type: "playwright.observer.operation.completed",
        executionId: observation.context.executionId,
        profileId: observation.context.profile.id,
        operationId: observation.operation.id,
        operationKind: observation.operation.kind,
        ok: true,
        data: {
          observer: componentData(observer),
          stage: observation.stage
        }
      });
    } catch (error) {
      const evidenceError = errorToEvidence(error);
      observation.context.evidence.emit({
        type: "playwright.observer.operation.failed",
        executionId: observation.context.executionId,
        profileId: observation.context.profile.id,
        operationId: observation.operation.id,
        operationKind: observation.operation.kind,
        ok: false,
        data: {
          observer: componentData(observer),
          stage: observation.stage
        },
        error: evidenceError
      });
      throw error;
    }
  }
}

export async function toPlaywrightObservationLocator(
  root: LocatorRoot,
  bindings: ResolvedObservationBinding[],
  options?: LocatorResolutionOptions
): Promise<Locator> {
  if (bindings.length === 0) {
    throw new Error("Expected at least one ObservationBinding");
  }

  const locators = await Promise.all(
    bindings.map((binding) => toPlaywrightBindingLocator(root, binding, options))
  );

  return locators.reduce((left, right) => left.or(right));
}

export async function toPlaywrightLocator(
  root: LocatorRoot,
  locator: ResolvedAccessibleLocator,
  options?: LocatorResolutionOptions
): Promise<Locator> {
  const scopedRoot = await locator.contexts.reduce(
    async (currentRoot, contextLocator) =>
      toPlaywrightLocator(await currentRoot, contextLocator, options),
    Promise.resolve(root)
  );
  const roleLocator = getRoleLocator(scopedRoot, locator);

  return locator.features
    .filter((feature) => !roleOptionFeatureNames.has(feature.name))
    .reduce((currentLocator, feature) => applyFeature(currentLocator, feature), roleLocator);
}

export async function activatePlaywrightLocator(
  locator: Locator,
  command: JourneyInteractionCommand,
  text?: string
): Promise<void> {
  switch (command) {
    case "pointer-click":
      await locator.click();
      return;
    case "keyboard-space":
      await locator.press("Space");
      return;
    case "keyboard-enter":
      await locator.press("Enter");
      return;
    case "keyboard-text-entry":
      if (!text) {
        throw new Error("keyboard-text-entry requires a transition text value");
      }
      await locator.pressSequentially(text);
      return;
    default:
      assertNever(command);
  }
}

async function toPlaywrightBindingLocator(
  root: LocatorRoot,
  binding: ResolvedObservationBinding,
  options?: LocatorResolutionOptions
): Promise<Locator> {
  if (binding.locators.length === 0) {
    throw new Error(`ObservationBinding ${binding.id} must define at least one locator`);
  }

  const locators = await Promise.all(
    binding.locators.map((locator) => toPlaywrightLocator(root, locator, options))
  );

  return locators.reduce((left, right) => left.and(right));
}

function getRoleLocator(
  root: LocatorRoot,
  locator: ResolvedAccessibleLocator
): Locator {
  if (!locator.role) {
    throw new Error(`AccessibleLocator ${locator.id} does not declare a role`);
  }
  if (locator.accessibleDescription) {
    throw new Error(
      `AccessibleLocator ${locator.id} uses accessibleDescriptionRef, which this adapter does not yet support`
    );
  }

  return root.getByRole(locator.role as never, {
    name: locator.accessibleName ? accessibleNamePattern(locator.accessibleName) : undefined,
    expanded: expandedOption(locator)
  });
}

function applyFeature(locator: Locator, feature: AccessibleFeature): Locator {
  if (feature.value === "*") return locator;
  throw new Error(`No Playwright adapter for AccessibleFeature ${feature.name}`);
}

async function assertPlaywrightLocator(
  locator: Locator,
  expectedCount: number,
  options: { timeoutMs: number }
): Promise<void> {
  await pollUntil(
    async () => {
      const count = await locator.count();
      return count === expectedCount ? "ok" : `count:${count}`;
    },
    {
      message: `Expected locator count ${expectedCount}`,
      timeoutMs: options.timeoutMs
    }
  );

  if (expectedCount > 0) {
    await locator.first().waitFor({
      state: "visible",
      timeout: options.timeoutMs
    });
  }
}

async function pollUntil(
  check: () => Promise<string>,
  options: { message: string; timeoutMs: number }
): Promise<void> {
  const startedAt = Date.now();
  let lastValue = "not-run";

  while (Date.now() - startedAt <= options.timeoutMs) {
    lastValue = await check();
    if (lastValue === "ok") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`${options.message}; last value: ${lastValue}`);
}

function expandedOption(locator: ResolvedAccessibleLocator): boolean | undefined {
  const expandedFeatures = locator.features.filter((feature) => feature.name === "expanded");
  if (expandedFeatures.length === 0) return undefined;
  if (expandedFeatures.length > 1) {
    throw new Error(`AccessibleLocator ${locator.id} repeats expanded`);
  }

  if (expandedFeatures[0].value === "true") return true;
  if (expandedFeatures[0].value === "false") return false;
  throw new Error(
    `AccessibleLocator ${locator.id} has invalid expanded value ${expandedFeatures[0].value}`
  );
}

function accessibleNamePattern(value: string): RegExp {
  return new RegExp(escapeRegExp(value), "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireExecutionState(
  executions: Map<string, AdapterExecutionState>,
  executionId: string
): AdapterExecutionState {
  const state = executions.get(executionId);
  if (!state) {
    throw new Error(`No Playwright execution state for ${executionId}`);
  }

  return state;
}

function collectLocatorIds(locators: ResolvedAccessibleLocator[]): string[] {
  return locators.flatMap((locator) => [locator.id, ...collectLocatorIds(locator.contexts)]);
}

function resolveArtifactOptions(
  options: PlaywrightArtifactOptions | undefined
): ResolvedArtifactOptions {
  const mode = options?.mode ?? "off";
  return {
    mode,
    sink: options?.sink,
    traces: options?.traces ?? true,
    screenshots: options?.screenshots ?? true,
    videos: options?.videos ?? false
  };
}

function shouldRetainArtifacts(
  context: AdapterExecutionContext,
  mode: PlaywrightArtifactMode
): boolean {
  if (mode === "always") return true;
  if (mode === "off") return false;

  return context.evidence.snapshot().some((event) =>
    event.executionId === context.executionId &&
    event.type === "profile.execution.failed" &&
    event.ok === false
  );
}

function trackedPages(record: BrowserContextRecord): Page[] {
  return uniqueObjects([...record.pages, ...record.browserContext.pages()]);
}

function uniqueObjects<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
}

function emitArtifactFailure(
  context: AdapterExecutionContext,
  type: string,
  error: unknown,
  data: JsonObject
): void {
  context.evidence.emit({
    type,
    executionId: context.executionId,
    profileId: context.profile.id,
    ok: false,
    error: errorToEvidence(error),
    data
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function componentData(component: { name: string; version?: string }): JsonObject {
  return {
    name: component.name,
    ...(component.version ? { version: component.version } : {})
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command ${value}`);
}
