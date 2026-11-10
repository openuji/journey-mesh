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
import { type WebJourneyDriver } from "@openuji/journey-driver-web";
import {
  executionDescriptor,
  type AccessibleFeature,
  type InputModalityDecision,
  type JourneyAdapter,
  type JourneyAdapterCloseInput,
  type JourneyAdapterExecution,
  type JourneyAdapterExecutionInput,
  type JourneyExecutionContext,
  type JourneyExecutionDescriptor,
  type JourneyPlanOperation,
  type ResolvedAccessibleLocator,
  type ResolvedObservationBinding,
  type StatePlanOperation,
  type TransitionPlanOperation
} from "@openuji/journey-runner";
import { ensureChromiumInstalled } from "./browser-binary.js";
import type { PlaywrightExecutionObserver } from "./observers/contracts.js";
import { PlaywrightObserverDispatcher } from "./observers/playwright-observer-dispatcher.js";
import { playwrightCommandForModality, type PlaywrightInteractionCommand } from "./input-modalities.js";
import {
  initialPlaywrightLifecycleState,
  reducePlaywrightLifecycle,
  type PlaywrightLifecycleState,
  type PlaywrightResource
} from "./lifecycle.js";

export { playwrightCommandForModality } from "./input-modalities.js";
export type { PlaywrightInteractionCommand } from "./input-modalities.js";
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
export { playwrightJsonEvidenceReporter, playwrightJourneyRunSummaryReporter } from "./reporters.js";
export type {
  PlaywrightExecutionObserver,
  PlaywrightJourneyObserver,
  PlaywrightObserverExecutionStartedInput,
  PlaywrightOperationObservation
} from "./observers/contracts.js";
export type {
  PlaywrightJourneyRunSummaryReporter,
  PlaywrightJourneyRunSummaryReporterOptions,
  PlaywrightJsonEvidenceReporter,
  PlaywrightJsonEvidenceReporterOptions,
  PlaywrightSummaryArtifact,
  PlaywrightSummaryArtifactSource,
  PlaywrightTestAttachment,
  PlaywrightTestInfoLike
} from "./reporters.js";

export type PlaywrightAdapterOptions = Readonly<{
  driver: WebJourneyDriver;
  executionObservers?: readonly PlaywrightExecutionObserver[];
  browser?: Browser;
  headless?: boolean;
  launchOptions?: LaunchOptions;
  contextOptions?: BrowserContextOptions;
  browserType?: Pick<BrowserType, "launch">;
  assertionTimeoutMs?: number;
  actionTimeoutMs?: number;
  navigationTimeoutMs?: number;
}>;

export type LocatorRoot = Page | Locator;

type PlaywrightSession = Readonly<{
  key: string;
  context: BrowserContext;
  page: Page;
}>;

const roleOptionFeatureNames = Object.freeze(["expanded", "accessible-name-exact"] as const);
const defaultAssertionTimeoutMs = 30_000;

export const playwrightAdapterName = "@openuji/journey-adapter-playwright";

export function playwrightSessionKey(operation: JourneyPlanOperation): string {
  return JSON.stringify([operation.actorId, operation.touchpointId]);
}

export function playwrightAdapter(options: PlaywrightAdapterOptions): JourneyAdapter {
  const configured = freezePlaywrightOptions(options);
  return Object.freeze({
    name: playwrightAdapterName,
    version: "0.1.0",
    describeOperation(operation) {
      if (operation.kind === "state") validatePlaywrightBindings(operation.target.bindings);
      if (operation.kind === "transition" && operation.activation.requiredInputModalityProfiles.length) {
        validatePlaywrightBindings(operation.activation.bindings);
      }
      return Object.freeze({ name: playwrightAdapterName, version: "0.1.0" });
    },
    createExecution(input) {
      return new PlaywrightAdapterExecution(input, configured);
    }
  });
}

function freezePlaywrightOptions(options: PlaywrightAdapterOptions): PlaywrightAdapterOptions {
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

class PlaywrightAdapterExecution implements JourneyAdapterExecution {
  private state: PlaywrightLifecycleState = initialPlaywrightLifecycleState();
  private readonly context: JourneyExecutionContext;
  private readonly execution: JourneyExecutionDescriptor;
  private readonly observers: PlaywrightObserverDispatcher;

  constructor(
    input: JourneyAdapterExecutionInput,
    private readonly options: PlaywrightAdapterOptions
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
    const target = this.options.driver.resolveEntry(operation);
    const session = await this.sessionForOperation(operation);
    this.context.signal?.throwIfAborted();
    await session.page.goto(target.url, { waitUntil: "domcontentloaded" });
    this.context.signal?.throwIfAborted();
  }

  async assertState(operation: StatePlanOperation): Promise<void> {
    const page = (await this.sessionForOperation(operation)).page;
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
  }

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
    const command = playwrightCommandForModality(decision.modality.id);
    const page = (await this.sessionForOperation(operation)).page;
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
    const text = command === "keyboard-text-entry"
      ? this.options.driver.resolveTransitionValue(operation)
      : undefined;
    this.context.signal?.throwIfAborted();
    await activatePlaywrightLocator(locator, command, text);
    this.context.signal?.throwIfAborted();
  }

  async recordControlFlow(operation: Parameters<JourneyAdapterExecution["recordControlFlow"]>[0]): Promise<void> {
    this.requireStarted();
    await this.observers.observe({ execution: this.execution, operation, stage: "control-flow-recorded" });
  }

  async close(_input: JourneyAdapterCloseInput): Promise<void> {
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
    const context = await browser.newContext(this.options.contextOptions);
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
      throw new Error(`Playwright adapter execution ${this.context.executionId} is not started (${this.state.status})`);
    }
  }
}

async function launchBrowser(options: PlaywrightAdapterOptions): Promise<Browser> {
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

export async function toPlaywrightObservationLocator(
  root: LocatorRoot,
  bindings: readonly ResolvedObservationBinding[]
): Promise<Locator> {
  if (bindings.length === 0) throw new Error("Expected at least one ObservationBinding");
  const locators = await Promise.all(bindings.map((binding) => toPlaywrightBindingLocator(root, binding)));
  return locators.reduce((left, right) => left.or(right));
}

export async function toPlaywrightLocator(
  root: LocatorRoot,
  locator: ResolvedAccessibleLocator
): Promise<Locator> {
  const scopedRoot = await locator.contexts.reduce(
    async (currentRoot, contextLocator) => toPlaywrightLocator(await currentRoot, contextLocator),
    Promise.resolve(root)
  );
  const roleLocator = getRoleLocator(scopedRoot, locator);
  return locator.features
    .filter((feature) => !roleOptionFeatureNames.includes(feature.name as "expanded"))
    .reduce((currentLocator, feature) => applyFeature(currentLocator, feature), roleLocator);
}

export async function activatePlaywrightLocator(
  locator: Locator,
  command: PlaywrightInteractionCommand,
  text?: string
): Promise<void> {
  switch (command) {
    case "pointer-click": await locator.click(); return;
    case "keyboard-space": await locator.press("Space"); return;
    case "keyboard-enter": await locator.press("Enter"); return;
    case "keyboard-text-entry":
      if (!text) throw new Error("keyboard-text-entry requires a transition text value");
      await locator.pressSequentially(text);
      return;
  }
}

async function toPlaywrightBindingLocator(
  root: LocatorRoot,
  binding: ResolvedObservationBinding
): Promise<Locator> {
  if (binding.surfaceInstanceResolver && binding.surfaceInstanceResolver.instanceKeyFeature.value !== "*") {
    throw new Error(`Playwright does not support SurfaceInstanceResolver ${binding.surfaceInstanceResolver.id}`);
  }
  if (binding.locators.length === 0) throw new Error(`ObservationBinding ${binding.id} must define at least one locator`);
  const locators = await Promise.all(binding.locators.map((locator) => toPlaywrightLocator(root, locator)));
  return locators.reduce((left, right) => left.and(right));
}

function getRoleLocator(root: LocatorRoot, locator: ResolvedAccessibleLocator): Locator {
  if (!locator.role) throw new Error(`AccessibleLocator ${locator.id} does not declare a role`);
  if (locator.accessibleDescription) {
    throw new Error(`AccessibleLocator ${locator.id} uses accessibleDescriptionRef, which this adapter does not yet support`);
  }
  const exact = exactNameOption(locator);
  return root.getByRole(locator.role as never, {
    name: locator.accessibleName ? (exact ? locator.accessibleName : accessibleNamePattern(locator.accessibleName)) : undefined,
    exact,
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
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<void> {
  await pollUntil(async () => {
    const count = await locator.count();
    return count === expectedCount ? "ok" : `count:${count}`;
  }, { message: `Expected locator count ${expectedCount}`, ...options });
  options.signal?.throwIfAborted();
  if (expectedCount > 0) await locator.first().waitFor({ state: "visible", timeout: options.timeoutMs });
}

async function pollUntil(
  check: () => Promise<string>,
  options: { message: string; timeoutMs: number; signal?: AbortSignal }
): Promise<void> {
  const startedAt = Date.now();
  let lastValue = "not-run";
  while (Date.now() - startedAt <= options.timeoutMs) {
    options.signal?.throwIfAborted();
    lastValue = await check();
    options.signal?.throwIfAborted();
    if (lastValue === "ok") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${options.message}; last value: ${lastValue}`);
}

function expandedOption(locator: ResolvedAccessibleLocator): boolean | undefined {
  const expanded = locator.features.filter((feature) => feature.name === "expanded" && feature.value !== "*");
  if (expanded.length === 0) return undefined;
  if (expanded.length > 1) throw new Error(`AccessibleLocator ${locator.id} repeats expanded`);
  if (expanded[0]!.value === "true") return true;
  if (expanded[0]!.value === "false") return false;
  throw new Error(`AccessibleLocator ${locator.id} has invalid expanded value ${expanded[0]!.value}`);
}

function exactNameOption(locator: ResolvedAccessibleLocator): boolean | undefined {
  const exact = locator.features.filter((feature) => feature.name === "accessible-name-exact" && feature.value !== "*");
  if (exact.length === 0) return undefined;
  if (exact.length > 1) throw new Error(`AccessibleLocator ${locator.id} repeats accessible-name-exact`);
  if (exact[0]!.value === "true") return true;
  if (exact[0]!.value === "false") return false;
  throw new Error(`AccessibleLocator ${locator.id} has invalid accessible-name-exact value ${exact[0]!.value}`);
}

function accessibleNamePattern(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

const supportedRoles: readonly Parameters<Page["getByRole"]>[0][] = Object.freeze([
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption",
  "cell", "checkbox", "code", "columnheader", "combobox", "complementary", "contentinfo", "definition",
  "deletion", "dialog", "directory", "document", "emphasis", "feed", "figure", "form", "generic", "grid",
  "gridcell", "group", "heading", "img", "insertion", "link", "list", "listbox", "listitem", "log", "main",
  "marquee", "math", "meter", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "navigation",
  "none", "note", "option", "paragraph", "presentation", "progressbar", "radio", "radiogroup", "region", "row",
  "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator", "slider", "spinbutton", "status",
  "strong", "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox",
  "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem"
]);

function validatePlaywrightBindings(bindings: readonly ResolvedObservationBinding[]): void {
  if (!bindings.length) throw new Error("Expected at least one ObservationBinding");
  const validate = (locator: ResolvedAccessibleLocator): void => {
    if (!locator.role) throw new Error(`AccessibleLocator ${locator.id} does not declare a role`);
    if (!supportedRoles.includes(locator.role as Parameters<Page["getByRole"]>[0])) throw new Error(`Unsupported Playwright role for AccessibleLocator ${locator.id}`);
    if (locator.accessibleDescription) throw new Error(`AccessibleLocator ${locator.id} uses accessibleDescriptionRef, which this adapter does not yet support`);
    expandedOption(locator);
    exactNameOption(locator);
    for (const feature of locator.features) {
      if (!roleOptionFeatureNames.includes(feature.name as (typeof roleOptionFeatureNames)[number]) && feature.value !== "*") throw new Error(`No Playwright adapter for AccessibleFeature ${feature.name}`);
    }
    locator.contexts.forEach(validate);
  };
  for (const binding of bindings) {
    if (binding.surfaceInstanceResolver && binding.surfaceInstanceResolver.instanceKeyFeature.value !== "*") {
      throw new Error(`Playwright does not support SurfaceInstanceResolver ${binding.surfaceInstanceResolver.id}`);
    }
    if (!binding.locators.length) throw new Error(`ObservationBinding ${binding.id} must define at least one locator`);
    binding.locators.forEach(validate);
  }
}
