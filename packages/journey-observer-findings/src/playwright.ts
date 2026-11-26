import {
  toPlaywrightLocator,
  toPlaywrightObservationLocator,
  type PlaywrightCheck,
  type PlaywrightExecutionObserver,
  type PlaywrightFailureObservation
} from "@openuji/journey-executor-playwright/observation";
import { immutableSnapshot, type JourneyInputAction, type JourneyObserverOutput } from "@openuji/journey-core";
import {
  pointerInputModalityId,
  stepPosition,
  type ResolvedAccessibleLocator,
  type ResolvedObservationBinding,
  type StatePlanOperation,
  type TransitionPlanOperation
} from "@openuji/journey-execution-model";
import type { JourneyArtifactStore } from "@openuji/journey-plugin";
import type { RunResult } from "@openuji/journey-runner";
import {
  findingsEvidenceFormat,
  findingsObserverKind,
  normalizedName,
  type CaptureError,
  type ConfirmedState,
  type ElementFact,
  type ExpectedTarget,
  type FailureCapture,
  type FindingSnapshot,
  type FindingsEvidence
} from "./evidence.js";
import { describe, focusFact, focusIs, nameSimilarity, sameIgnoringWhitespace, viewportOf, type Locator, type Page, type Viewport } from "./facts.js";

export type FindingsConfiguration = Readonly<{ id: string }>;

const candidateLimit = 5;
const candidateScan = 30;
const screenshotTimeoutMs = 5_000;

const fileSegment = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_");
const errorOf = (error: unknown): CaptureError => ({ name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) });

type Shot = Readonly<{ png: Uint8Array; viewport: Viewport; scale: number; browser?: string }>;

/**
 * What a failed check compared with the page. `objects` for a State's or the Transition's object, which
 * must be there in the expected number; `user` for where the user is: focus, the pointer, or the object
 * a ShortcutStep acts on.
 */
type Checked =
  | Readonly<{ kind: "objects"; expected: "state" | "activation"; bindings: readonly ResolvedObservationBinding[]; expectedCount: number }>
  | Readonly<{ kind: "user"; expected: "focus" | "pointer" | "shortcut"; locator?: ResolvedAccessibleLocator; start?: true; stepId?: string }>;

/**
 * Captures every failed check of what the model declares where it happens: a screenshot, the focused
 * object, what the check expected, and the closest elements. It keeps a screenshot of the last State
 * each execution confirmed, in memory, and writes it only beside a failure. It only reads the page and
 * never throws, so it cannot change an operation or a verdict. `artifacts` stores the screenshots;
 * without it, only the facts are kept.
 */
export function findingsObserver(options: FindingsConfiguration, artifacts?: JourneyArtifactStore): PlaywrightExecutionObserver & {
  readonly evidence: FindingsEvidence;
  output(result: RunResult): Promise<JourneyObserverOutput>;
} {
  const config = immutableSnapshot(options);
  const failures: FailureCapture[] = [];
  const problems: CaptureError[] = [];
  const actions = new Map<string, JourneyInputAction>();
  /** The last State each execution confirmed, by execution. */
  const confirmed = new Map<string, Shot & Readonly<{ operationId: string }>>();
  /** Confirmed States already written beside a failure, by execution and operation. */
  const written = new Map<string, ConfirmedState>();
  let fileSequence = 0;

  async function screenshot(page: Page): Promise<Shot> {
    const viewport = await viewportOf(page);
    const scale = await page.evaluate("devicePixelRatio") as number;
    const png = await page.screenshot({ fullPage: false, timeout: screenshotTimeoutMs });
    const browser = page.context().browser();
    return { png, viewport, scale, ...(browser ? { browser: `${browser.browserType().name()} ${browser.version()}` } : {}) };
  }

  async function write(kind: "failure" | "state", executionId: string, png: Uint8Array, scope: Parameters<JourneyArtifactStore["write"]>[0]["scope"]): Promise<string> {
    const file = await artifacts!.write({ name: `${fileSegment(config.id)}.${kind}.${fileSegment(executionId)}.${String(fileSequence++).padStart(3, "0")}.png`, data: png, contentType: "image/png", ...(scope ? { scope } : {}) });
    return file.href;
  }

  /** The last confirmed State of the execution, written once, however many failures follow it. */
  async function before(ids: Readonly<{ runId: string; executionId: string; profileId: string }>): Promise<ConfirmedState | undefined> {
    const state = confirmed.get(ids.executionId);
    if (!state || !artifacts) return undefined;
    const key = JSON.stringify([ids.executionId, state.operationId]);
    if (!written.has(key)) {
      const href = await write("state", ids.executionId, state.png, { ...ids, operationId: state.operationId });
      written.set(key, { operationId: state.operationId, screenshot: { href, viewport: state.viewport, scale: state.scale } });
    }
    return written.get(key);
  }

  async function capture({ execution, operation, page, action, error, check }: PlaywrightFailureObservation): Promise<void> {
    const ids = { runId: execution.runId, executionId: execution.executionId, profileId: execution.profile.id, operationId: operation.id };
    const snapshot: { -readonly [K in keyof FindingSnapshot]: FindingSnapshot[K] } = { focus: null };
    const checked = whatWasChecked(operation, check);
    let expected: ExpectedTarget | undefined;
    let target: ElementFact | undefined;
    let candidates: FailureCapture["candidates"] = [];
    let confirmedBefore: ConfirmedState | undefined;
    try {
      const shot = await screenshot(page);
      if (artifacts) {
        snapshot.screenshot = { href: await write("failure", execution.executionId, shot.png, ids), viewport: shot.viewport, scale: shot.scale };
        confirmedBefore = await before(ids);
      }
      if (shot.browser) snapshot.browser = shot.browser;
      const path = pathOf(page);
      if (path) snapshot.path = path;
      snapshot.focus = await focusFact(page, shot.viewport);
      if (checked?.kind === "objects") {
        const located = await toPlaywrightObservationLocator(page, checked.bindings);
        const first = checked.bindings[0]?.locators[0];
        expected = { kind: checked.expected, ...(first ? describeLocator(first) : {}), expectedCount: checked.expectedCount, count: await located.count() };
        if (expected.count === 1) target = await describe(page, located, shot.viewport);
        if (first) candidates = await candidatesFor(page, first, shot.viewport);
      } else if (checked?.expected === "focus") {
        // Where focus is (above) against where the check expected it, when it names an object.
        const start = checked.start ? { start: true as const } : {};
        if (checked.locator) {
          const located = await toPlaywrightLocator(page, checked.locator);
          expected = { kind: "focus", ...start, ...describeLocator(checked.locator), expectedCount: 1, count: await located.count() };
          if (expected.count === 1) {
            target = await describe(page, located, shot.viewport);
            snapshot.expectedFocus = target;
            snapshot.focusIsExpected = await focusIs(page, located);
          }
        } else {
          expected = { kind: "focus", ...start, expectedCount: 1 };
        }
      } else if (checked?.locator) {
        // The pointer or a shortcut needs exactly one object: what is there instead, never focus.
        const located = await toPlaywrightLocator(page, checked.locator);
        expected = { kind: checked.expected, ...(checked.start ? { start: true as const } : {}), ...describeLocator(checked.locator), expectedCount: 1, count: await located.count() };
        if (expected.count === 1) target = await describe(page, located, shot.viewport);
        candidates = await candidatesFor(page, checked.locator, shot.viewport);
      }
    } catch (failure) { snapshot.error = errorOf(failure); }
    const stepId = checked?.kind === "user" ? checked.stepId : undefined;
    failures.push(immutableSnapshot({
      ...ids, error,
      ...(stepId ? { stepId } : {}), ...(action?.gesture ? { gesture: action.gesture } : {}),
      ...(expected ? { expected } : {}), ...(target ? { target } : {}), candidates, snapshot,
      ...(confirmedBefore ? { before: confirmedBefore } : {})
    }));
  }

  return {
    name: "@openuji/journey-observer-findings",
    get evidence() { return evidenceOf(undefined); },
    onAction(action) { actions.set(action.id, immutableSnapshot(action)); },
    async observeOperation(observation) {
      if (observation.stage !== "state-asserted") return;
      try { confirmed.set(observation.execution.executionId, { operationId: observation.operation.id, ...await screenshot(observation.page) }); }
      catch (error) { problems.push(errorOf(error)); }
    },
    async observeFailure(failure) {
      try { await capture(failure); } catch (error) { problems.push(errorOf(error)); }
    },
    async output(result) {
      return immutableSnapshot({ id: config.id, kind: findingsObserverKind, measurements: [], evidence: evidenceOf(result.runId), errors: [] });
    }
  };

  function evidenceOf(runId: string | undefined): FindingsEvidence {
    const inRun = <T extends { runId: string }>(items: Iterable<T>) => [...items].filter((item) => runId === undefined || item.runId === runId);
    return immutableSnapshot({ format: findingsEvidenceFormat, version: 1, failures: inRun(failures), actions: inRun(actions.values()), problems: [...problems] });
  }
}

/**
 * What the failed check compared with the page, from the check the executor reports and the model.
 * Where the user is comes from the move kinds' type (`stepPosition`), as the executor decides it.
 */
function whatWasChecked(operation: StatePlanOperation | TransitionPlanOperation, check: PlaywrightCheck): Checked | undefined {
  if (operation.kind === "state") return { kind: "objects", expected: "state", bindings: operation.target.bindings, expectedCount: operation.target.expectedMatchCount };
  if (check.kind === "state" || check.kind === "target") return { kind: "objects", expected: "activation", bindings: operation.activation.bindings, expectedCount: 1 };
  if (check.kind === "entry") {
    const bindings = operation.activation.bindings;
    const locator = bindings.length === 1 && bindings[0]!.locators.length === 1 ? bindings[0]!.locators[0] : undefined;
    return { kind: "user", expected: "focus", ...(locator ? { locator } : {}) };
  }
  const materialization = operation.materializations?.find((item) => item.id === check.materializationId);
  if (!materialization) return undefined;
  if (check.kind === "start") {
    const first = materialization.steps[0];
    const pointer = first ? stepPosition(materialization, first) === "pointer" : materialization.modality.id === pointerInputModalityId;
    return { kind: "user", expected: pointer ? "pointer" : "focus", start: true, ...(materialization.startLocator ? { locator: materialization.startLocator } : {}) };
  }
  const step = materialization.steps.find((item) => item.id === check.stepId);
  if (!step) return undefined;
  // A ShortcutStep acts on its own object. Every other step checks where the user is.
  const position = step.kind === "shortcut" ? "shortcut" : stepPosition(materialization, step);
  if (position === "other") return undefined;
  return { kind: "user", expected: position, stepId: step.id, ...(step.locator ? { locator: step.locator } : {}) };
}

function describeLocator(locator: ResolvedAccessibleLocator): Pick<ExpectedTarget, "role" | "name" | "context"> {
  const context = locator.contexts.at(-1);
  return {
    ...(locator.role ? { role: locator.role } : {}),
    ...(locator.accessibleName ? { name: locator.accessibleName } : {}),
    ...(context ? { context: { ...(context.role ? { role: context.role } : {}), ...(context.accessibleName ? { name: context.accessibleName } : {}) } } : {})
  };
}

/**
 * Elements with the expected role, inside the expected context when it resolves to one element (so
 * the header's search box is never offered for a dialog's combobox), most similar name first.
 */
async function candidatesFor(page: Page, locator: ResolvedAccessibleLocator, viewport: Viewport): Promise<FailureCapture["candidates"]> {
  if (!locator.role || locator.extensions) return [];
  let root: Page | Locator = page;
  for (const context of locator.contexts) {
    const scoped: Locator = await toPlaywrightLocator(root, context);
    if (await scoped.count() !== 1) { root = page; break; }
    root = scoped;
  }
  const all = (await root.getByRole(locator.role as Parameters<Page["getByRole"]>[0]).all()).slice(0, candidateScan);
  const facts: ElementFact[] = [];
  for (const element of all) {
    if (!await element.isVisible()) continue;
    facts.push(await describe(page, element, viewport));
  }
  const expected = locator.accessibleName ?? "";
  return facts
    .map((fact) => ({ fact, score: fact.name === undefined ? -1 : nameSimilarity(fact.name, expected) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, candidateLimit)
    .map(({ fact }) => Object.freeze({ ...fact, sameIgnoringWhitespace: fact.name !== undefined && !!expected
      && normalizedName(fact.name) !== normalizedName(expected) && sameIgnoringWhitespace(fact.name, expected) }));
}

/** Path and hash of an http(s) page; never an origin, a query or a local file path. */
function pathOf(page: Page): string | undefined {
  try {
    const url = new URL(page.url());
    return url.protocol === "http:" || url.protocol === "https:" ? `${url.pathname}${url.hash}` : undefined;
  } catch { return undefined; }
}
