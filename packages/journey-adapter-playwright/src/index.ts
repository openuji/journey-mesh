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
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyAdapter,
  JourneyAdapterCloseInput,
  JourneyAdapterExecution,
  JourneyAdapterExecutionInput,
  JourneyInteractionCommand,
  JourneyExecutionContext,
  JourneyObserver,
  JourneyPlanOperation,
  JsonObject,
  ResolvedAccessibleLocator,
  ResolvedObservationBinding,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-runner";
import type { ExecutionEvidenceSink } from "@openuji/journey-evidence";
import { PlaywrightEvidence } from "./evidence/playwright-evidence.js";

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

export type PlaywrightDriverExecutionContext = JourneyExecutionContext & {
  browser: Browser;
  createBrowserContext(
    input?: PlaywrightCreateBrowserContextInput
  ): Promise<BrowserContext>;
};

export type PlaywrightDriverCloseInput = {
  readonly executionFailed: boolean;
};

export type PlaywrightJourneyDriver = {
  readonly name: string;
  readonly version?: string;
  createExecution(
    input: PlaywrightDriverExecutionInput
  ): PlaywrightJourneyDriverExecution;
};

export type PlaywrightDriverExecutionInput = {
  readonly context: PlaywrightDriverExecutionContext;
  readonly evidence: ExecutionEvidenceSink;
};

export type PlaywrightJourneyDriverExecution = {
  start(): Promise<void> | void;
  openEntry(operation: JourneyPlanOperation): Promise<void> | void;
  pageForOperation(operation: JourneyPlanOperation): Promise<Page> | Page;
  transitionValue(operation: TransitionPlanOperation): Promise<string | undefined> | string | undefined;
  afterTransition(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision
  ): Promise<void> | void;
  recordControlFlow(operation: ControlFlowPlanOperation): Promise<void> | void;
  close(input: PlaywrightDriverCloseInput): Promise<void> | void;
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
  const artifactOptions = resolveArtifactOptions(options.artifacts);

  if (artifactOptions.mode !== "off" && !artifactOptions.sink) {
    throw new Error("Playwright artifacts require an artifact sink");
  }

  return {
    name: "@openuji/journey-adapter-playwright",
    version: "0.1.0",

    createExecution(input) {
      return new PlaywrightAdapterExecution(input, options, artifactOptions);
    }
  };
}

class PlaywrightAdapterExecution implements JourneyAdapterExecution {
  private browser?: Browser;
  private ownsBrowser = false;
  private driverContext?: PlaywrightDriverExecutionContext;
  private driverExecution?: PlaywrightJourneyDriverExecution;
  private readonly browserContexts: BrowserContextRecord[] = [];
  private readonly context: JourneyExecutionContext;
  private readonly events: PlaywrightEvidence;
  private readonly evidence: ExecutionEvidenceSink;
  private lifecycle: "created" | "starting" | "started" | "closing" | "closed" = "created";

  constructor(
    input: JourneyAdapterExecutionInput,
    private readonly options: PlaywrightAdapterOptions,
    private readonly artifactOptions: ResolvedArtifactOptions
  ) {
    this.context = input.context;
    this.evidence = input.evidence;
    this.events = new PlaywrightEvidence(input.context, input.evidence);
  }

  async start(): Promise<void> {
    if (this.lifecycle !== "created") {
      throw new Error(`Playwright adapter execution ${this.context.executionId} cannot start from ${this.lifecycle}`);
    }

    this.lifecycle = "starting";
    this.browser = this.options.browser ?? await launchBrowser(this.options);
    this.ownsBrowser = this.options.browser === undefined;
    this.driverContext = {
      ...this.context,
      browser: this.browser,
      createBrowserContext: (input) => this.createBrowserContext(input)
    };
    this.driverExecution = this.options.driver.createExecution({
      context: this.driverContext,
      evidence: this.evidence
    });
    this.events.browserStarted({
      owned: this.ownsBrowser,
      headless: this.ownsBrowser ? this.options.headless ?? true : null,
      driver: this.options.driver
    });

    await this.driverExecution.start();
    this.lifecycle = "started";
  }

  async openEntry(operation: JourneyPlanOperation): Promise<void> {
    await this.requireStartedDriver().openEntry(operation);
  }

  async assertState(operation: StatePlanOperation): Promise<void> {
    const driver = this.requireStartedDriver();
    const context = this.requireDriverContext();
    const page = await driver.pageForOperation(operation);
    const locator = await toPlaywrightObservationLocator(page, operation.target.bindings, {
      operation,
      context,
      driver: this.options.driver
    });

    await assertPlaywrightLocator(locator, operation.target.expectedMatchCount, {
      timeoutMs: this.options.assertionTimeoutMs ?? defaultAssertionTimeoutMs
    });

    this.events.assertionCompleted(operation);

    await notifyPlaywrightObservers({
      context,
      expectedMatchCount: operation.target.expectedMatchCount,
      locator,
      operation,
      page,
      stage: "state-asserted"
    }, this.events);
  }

  async performTransition(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision
  ): Promise<void> {
    const driver = this.requireStartedDriver();
    const context = this.requireDriverContext();
    const page = await driver.pageForOperation(operation);
    const locator = await toPlaywrightObservationLocator(page, operation.activation.bindings, {
      operation,
      context,
      driver: this.options.driver
    });

    await assertPlaywrightLocator(locator, 1, {
      timeoutMs: this.options.assertionTimeoutMs ?? defaultAssertionTimeoutMs
    });

    await notifyPlaywrightObservers({
      context,
      decision,
      expectedMatchCount: 1,
      locator,
      operation,
      page,
      stage: "transition-ready"
    }, this.events);

    const text = decision.command === "keyboard-text-entry"
      ? await driver.transitionValue(operation)
      : undefined;

    await activatePlaywrightLocator(locator, decision.command, text);
    await driver.afterTransition(operation, decision);

    this.events.transitionCompleted(operation, decision);
  }

  async recordControlFlow(operation: ControlFlowPlanOperation): Promise<void> {
    const driver = this.requireStartedDriver();
    const context = this.requireDriverContext();
    await driver.recordControlFlow(operation);
    await notifyPlaywrightObservers({
      context,
      operation,
      stage: "control-flow-recorded"
    }, this.events);
  }

  async close(input: JourneyAdapterCloseInput): Promise<void> {
    if (this.lifecycle === "closed" || this.lifecycle === "closing") {
      return;
    }

    this.lifecycle = "closing";
    const retainArtifacts = shouldRetainArtifacts(input.executionFailed, this.artifactOptions.mode);

    try {
      await captureScreenshotsAndStopTraces(
        this.browserContexts,
        this.context,
        this.events,
        this.artifactOptions,
        retainArtifacts
      );
      await this.driverExecution?.close({ executionFailed: input.executionFailed });
    } finally {
      await closeTrackedBrowserContexts(this.browserContexts, this.events);
      await attachVideos(this.browserContexts, this.context, this.events, this.artifactOptions, retainArtifacts);
      if (this.ownsBrowser && this.browser) {
        await this.browser.close();
      }
      if (this.browser) {
        this.events.browserStopped({ owned: this.ownsBrowser });
      }
      this.lifecycle = "closed";
    }
  }

  private async createBrowserContext(
    input: PlaywrightCreateBrowserContextInput = {}
  ): Promise<BrowserContext> {
    const browser = this.requireBrowser();
    const id = `context-${String(this.browserContexts.length + 1).padStart(2, "0")}`;
    const label = input.label ?? id;
    const browserContextOptions = await browserContextOptionsForArtifacts(
      this.options,
      this.artifactOptions
    );
    const browserContext = await browser.newContext(browserContextOptions);
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

    this.browserContexts.push(record);
    this.events.browserContextCreated(record, input);

    if (this.artifactOptions.mode !== "off" && this.artifactOptions.traces) {
      await browserContext.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true
      });
      record.traceStarted = true;
      this.events.traceStarted(record);
    }

    return browserContext;
  }

  private requireStartedDriver(): PlaywrightJourneyDriverExecution {
    if (this.lifecycle !== "started" || !this.driverExecution) {
      throw new Error(`Playwright adapter execution ${this.context.executionId} is not started`);
    }

    return this.driverExecution;
  }

  private requireDriverContext(): PlaywrightDriverExecutionContext {
    if (!this.driverContext) {
      throw new Error(`Playwright adapter execution ${this.context.executionId} has no driver context`);
    }

    return this.driverContext;
  }

  private requireBrowser(): Browser {
    if (!this.browser) {
      throw new Error(`Playwright adapter execution ${this.context.executionId} has no browser`);
    }

    return this.browser;
  }
}

async function launchBrowser(options: PlaywrightAdapterOptions): Promise<Browser> {
  const browserType = options.browserType ?? chromium;
  return browserType.launch({
    headless: options.headless ?? true,
    ...options.launchOptions
  });
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
  browserContexts: readonly BrowserContextRecord[],
  context: JourneyExecutionContext,
  evidence: PlaywrightEvidence,
  artifactOptions: ResolvedArtifactOptions,
  retainArtifacts: boolean
): Promise<void> {
  for (const browserContext of browserContexts) {
    if (retainArtifacts && artifactOptions.screenshots) {
      await captureScreenshots(browserContext, context, evidence, artifactOptions);
    }

    if (browserContext.traceStarted) {
      await stopTrace(browserContext, context, evidence, artifactOptions, retainArtifacts);
    }
  }
}

async function captureScreenshots(
  browserContext: BrowserContextRecord,
  context: JourneyExecutionContext,
  evidence: PlaywrightEvidence,
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
      evidence.screenshotAttached(browserContext, index, path);
    } catch (error) {
      evidence.screenshotFailed(browserContext, index, path, error);
    }
  }
}

async function stopTrace(
  browserContext: BrowserContextRecord,
  context: JourneyExecutionContext,
  evidence: PlaywrightEvidence,
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
      evidence.traceAttached(browserContext, path);
      return;
    }

    await browserContext.browserContext.tracing.stop();
  } catch (error) {
    evidence.traceFailed(browserContext, path, error);
  } finally {
    browserContext.traceStarted = false;
  }
}

async function closeTrackedBrowserContexts(
  browserContexts: readonly BrowserContextRecord[],
  evidence: PlaywrightEvidence
): Promise<void> {
  await Promise.all(
    browserContexts.map(async (record) => {
      try {
        await record.browserContext.close();
      } catch (error) {
        evidence.browserContextCloseFailed(record, error);
      }
    })
  );
}

async function attachVideos(
  browserContexts: readonly BrowserContextRecord[],
  context: JourneyExecutionContext,
  evidence: PlaywrightEvidence,
  artifactOptions: ResolvedArtifactOptions,
  retainArtifacts: boolean
): Promise<void> {
  if (!artifactOptions.videos) return;

  for (const browserContext of browserContexts) {
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
        evidence.videoAttached(browserContext, index, path);
      } catch (error) {
        evidence.videoFailed(browserContext, index, error);
      }
    }
  }
}

async function notifyPlaywrightObservers(
  observation: PlaywrightOperationObservation,
  evidence: PlaywrightEvidence
): Promise<void> {
  const observers = observation.context.observers.filter(isPlaywrightJourneyObserver);

  for (const observer of observers) {
    try {
      evidence.observerOperationStarted(observer, observation);
      await observer.observePlaywrightOperation(observation);
      evidence.observerOperationCompleted(observer, observation);
    } catch (error) {
      evidence.observerOperationFailed(observer, observation, error);
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
  executionFailed: boolean,
  mode: PlaywrightArtifactMode
): boolean {
  if (mode === "always") return true;
  if (mode === "off") return false;
  return executionFailed;
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

function assertNever(value: never): never {
  throw new Error(`Unhandled command ${value}`);
}
