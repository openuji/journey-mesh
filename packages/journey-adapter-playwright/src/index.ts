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

import {
  executionDescriptor,
  type AccessibleFeature,
  type ControlFlowPlanOperation,
  type InputModalityDecision,
  type JourneyAdapter,
  type JourneyAdapterCloseInput,
  type JourneyAdapterExecution,
  type JourneyAdapterExecutionInput,
  type JourneyInteractionCommand,
  type JourneyExecutionContext,
  type JourneyExecutionDescriptor,
  type JourneyPlanOperation,
  type JsonObject,
  type ResolvedAccessibleLocator,
  type ResolvedObservationBinding,
  type StatePlanOperation,
  type TransitionPlanOperation
} from "@openuji/journey-runner";
import type { PlaywrightExecutionObserver } from "./observers/contracts.js";
import { PlaywrightObserverDispatcher } from "./observers/playwright-observer-dispatcher.js";

export type {
  PlaywrightExecutionObserver,
  PlaywrightJourneyObserver,
  PlaywrightObserverExecutionStartedInput,
  PlaywrightOperationObservation
} from "./observers/contracts.js";

export type PlaywrightCreateBrowserContextInput = {
  operation?: JourneyPlanOperation;
  label?: string;
  data?: JsonObject;
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

export type PlaywrightAdapterOptions = {
  driver: PlaywrightJourneyDriver;
  executionObservers?: readonly PlaywrightExecutionObserver[];
  browser?: Browser;
  headless?: boolean;
  launchOptions?: LaunchOptions;
  contextOptions?: BrowserContextOptions;
  browserType?: Pick<BrowserType, "launch">;
  assertionTimeoutMs?: number;
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
};

const roleOptionFeatureNames = new Set(["expanded"]);
const defaultAssertionTimeoutMs = 30_000;

export function playwrightAdapter(options: PlaywrightAdapterOptions): JourneyAdapter {
  return {
    name: "@openuji/journey-adapter-playwright",
    version: "0.1.0",

    createExecution(input) {
      return new PlaywrightAdapterExecution(input, options);
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
  private readonly execution: JourneyExecutionDescriptor;
  private readonly observers: PlaywrightObserverDispatcher;
  private lifecycle: "created" | "starting" | "started" | "closing" | "closed" = "created";

  constructor(
    input: JourneyAdapterExecutionInput,
    private readonly options: PlaywrightAdapterOptions
  ) {
    this.context = input.context;
    this.execution = executionDescriptor(input.context);
    this.observers = new PlaywrightObserverDispatcher(
      options.executionObservers ?? [],
      this.execution
    );
  }

  async start(): Promise<void> {
    if (this.lifecycle !== "created") {
      throw new Error(`Playwright adapter execution ${this.context.executionId} cannot start from ${this.lifecycle}`);
    }

    this.lifecycle = "starting";
    await this.observers.executionStarted();

    this.browser = this.options.browser ?? await launchBrowser(this.options);
    this.ownsBrowser = this.options.browser === undefined;
    this.driverContext = {
      ...this.context,
      browser: this.browser,
      createBrowserContext: (input) => this.createBrowserContext(input)
    };
    this.driverExecution = this.options.driver.createExecution({
      context: this.driverContext
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

    await this.observers.observe({
      execution: this.execution,
      expectedMatchCount: operation.target.expectedMatchCount,
      locator,
      operation,
      page,
      stage: "state-asserted"
    });
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

    await this.observers.observe({
      execution: this.execution,
      decision,
      expectedMatchCount: 1,
      locator,
      operation,
      page,
      stage: "transition-ready"
    });

    const text = decision.command === "keyboard-text-entry"
      ? await driver.transitionValue(operation)
      : undefined;

    await activatePlaywrightLocator(locator, decision.command, text);
    await driver.afterTransition(operation, decision);
  }

  async recordControlFlow(operation: ControlFlowPlanOperation): Promise<void> {
    const driver = this.requireStartedDriver();
    await driver.recordControlFlow(operation);
    await this.observers.observe({
      execution: this.execution,
      operation,
      stage: "control-flow-recorded"
    });
  }

  async close(input: JourneyAdapterCloseInput): Promise<void> {
    if (this.lifecycle === "closed" || this.lifecycle === "closing") {
      return;
    }

    this.lifecycle = "closing";

    try {
      await this.driverExecution?.close({ executionFailed: input.executionFailed });
    } finally {
      await closeTrackedBrowserContexts(this.browserContexts);
      if (this.ownsBrowser && this.browser) {
        await this.browser.close();
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
    const browserContext = await browser.newContext(this.options.contextOptions);
    const record: BrowserContextRecord = {
      id,
      label,
      browserContext
    };

    this.browserContexts.push(record);

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

async function closeTrackedBrowserContexts(
  browserContexts: readonly BrowserContextRecord[]
): Promise<void> {
  await Promise.all(
    browserContexts.map(async (record) => {
      try {
        await record.browserContext.close();
      } catch {
        // Context close failures were previously reported only as detail evidence.
      }
    })
  );
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

function assertNever(value: never): never {
  throw new Error(`Unhandled command ${value}`);
}
