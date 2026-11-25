import {
  toPlaywrightLocator,
  toPlaywrightObservationLocator,
  type PlaywrightExecutionObserver,
  type PlaywrightFailureObservation
} from "@openuji/journey-executor-playwright/observation";
import { immutableSnapshot, type JourneyInputAction, type JourneyObserverOutput } from "@openuji/journey-core";
import {
  stepPosition,
  type ResolvedAccessibleLocator,
  type ResolvedMaterializationStep,
  type ResolvedTransitionMaterialization,
  type TransitionPlanOperation
} from "@openuji/journey-execution-model";
import type { JourneyArtifactStore } from "@openuji/journey-plugin";
import type { RunResult } from "@openuji/journey-runner";
import {
  findingsEvidenceFormat,
  findingsObserverKind,
  type CaptureError,
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

/**
 * Captures every failed operation where it happens: a screenshot, the focused object, what the failed
 * check expected, and the closest elements. What a finding is comes from the model: an operation that
 * failed against what it declares. It only reads the page and never throws, so it cannot change an
 * operation or a verdict. `artifacts` stores the screenshots; without it, only the facts are kept.
 */
export function findingsObserver(options: FindingsConfiguration, artifacts?: JourneyArtifactStore): PlaywrightExecutionObserver & {
  readonly evidence: FindingsEvidence;
  output(result: RunResult): Promise<JourneyObserverOutput>;
} {
  const config = immutableSnapshot(options);
  const failures: FailureCapture[] = [];
  const problems: CaptureError[] = [];
  const actions = new Map<string, JourneyInputAction>();
  let failureSequence = 0;

  async function screenshot(page: Page): Promise<{ png: Uint8Array; viewport: Viewport; scale: number; browser?: string }> {
    const viewport = await viewportOf(page);
    const scale = await page.evaluate("devicePixelRatio") as number;
    const png = await page.screenshot({ fullPage: false, timeout: screenshotTimeoutMs });
    const browser = page.context().browser();
    return { png, viewport, scale, ...(browser ? { browser: `${browser.browserType().name()} ${browser.version()}` } : {}) };
  }

  async function capture({ execution, operation, page, action, error }: PlaywrightFailureObservation): Promise<void> {
    const ids = { runId: execution.runId, executionId: execution.executionId, profileId: execution.profile.id, operationId: operation.id };
    const snapshot: { -readonly [K in keyof FindingSnapshot]: FindingSnapshot[K] } = { focus: null };
    let expected: ExpectedTarget | undefined;
    let target: ElementFact | undefined;
    let candidates: FailureCapture["candidates"] = [];
    try {
      const shot = await screenshot(page);
      if (artifacts) {
        const file = await artifacts.write({ name: `${fileSegment(config.id)}.failure.${fileSegment(execution.executionId)}.${String(failureSequence++).padStart(3, "0")}.png`, data: shot.png, contentType: "image/png", scope: ids });
        snapshot.screenshot = { href: file.href, viewport: shot.viewport, scale: shot.scale };
      }
      if (shot.browser) snapshot.browser = shot.browser;
      const path = pathOf(page);
      if (path) snapshot.path = path;
      snapshot.focus = await focusFact(page, shot.viewport);
      const failed = operation.kind === "transition" && action?.stepId ? stepOf(operation, action.stepId) : undefined;
      if (failed) {
        const check = checkOf(failed.materialization, failed.step);
        const declared = failed.step.locator;
        if (check === "focus") {
          // Where focus is (above) against where the step expected it, when it names an object.
          if (declared) {
            const located = await toPlaywrightLocator(page, declared);
            expected = { kind: "focus", ...describeLocator(declared), expectedCount: 1, count: await located.count() };
            if (expected.count === 1) {
              target = await describe(page, located, shot.viewport);
              snapshot.expectedFocus = target;
              snapshot.focusIsExpected = await focusIs(page, located);
            }
          } else {
            expected = { kind: "focus", expectedCount: 1 };
          }
        } else if (check && declared) {
          // The pointer or a shortcut needs exactly one object: what is there instead, never focus.
          const located = await toPlaywrightLocator(page, declared);
          expected = { kind: check, ...describeLocator(declared), expectedCount: 1, count: await located.count() };
          if (expected.count === 1) target = await describe(page, located, shot.viewport);
          candidates = await candidatesFor(page, declared, shot.viewport);
        }
      } else if (!action) {
        const bindings = operation.kind === "state" ? operation.target.bindings : operation.activation.bindings;
        const expectedCount = operation.kind === "state" ? operation.target.expectedMatchCount : 1;
        const located = await toPlaywrightObservationLocator(page, bindings);
        const first = bindings[0]?.locators[0];
        expected = { kind: operation.kind === "state" ? "state" : "activation", ...(first ? describeLocator(first) : {}), expectedCount, count: await located.count() };
        if (expected.count === 1) target = await describe(page, located, shot.viewport);
        if (first) candidates = await candidatesFor(page, first, shot.viewport);
      }
    } catch (failure) { snapshot.error = errorOf(failure); }
    failures.push(immutableSnapshot({
      ...ids, error,
      ...(action?.stepId ? { stepId: action.stepId } : {}), ...(action?.gesture ? { gesture: action.gesture } : {}),
      ...(expected ? { expected } : {}), ...(target ? { target } : {}), candidates, snapshot
    }));
  }

  return {
    name: "@openuji/journey-observer-findings",
    get evidence() { return evidenceOf(undefined); },
    onAction(action) { actions.set(action.id, immutableSnapshot(action)); },
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

/** The declared step that failed, with its materialization. */
function stepOf(operation: TransitionPlanOperation, stepId: string): { materialization: ResolvedTransitionMaterialization; step: ResolvedMaterializationStep } | undefined {
  for (const materialization of operation.materializations ?? []) {
    const step = materialization.steps.find((item) => item.id === stepId);
    if (step) return { materialization, step };
  }
  return undefined;
}

/**
 * What a failed step checked. A ShortcutStep acts on its own object. Every other step checks where the
 * user is, and its move kind's type (through `stepPosition`) says whether that is focus or the pointer.
 */
function checkOf(materialization: ResolvedTransitionMaterialization, step: ResolvedMaterializationStep): "focus" | "pointer" | "shortcut" | undefined {
  if (step.kind === "shortcut") return "shortcut";
  const position = stepPosition(materialization, step);
  return position === "other" ? undefined : position;
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
    .map(({ fact }) => Object.freeze({ ...fact, sameIgnoringWhitespace: fact.name !== undefined && !!expected && sameIgnoringWhitespace(fact.name, expected) }));
}

/** Path and hash of an http(s) page; never an origin, a query or a local file path. */
function pathOf(page: Page): string | undefined {
  try {
    const url = new URL(page.url());
    return url.protocol === "http:" || url.protocol === "https:" ? `${url.pathname}${url.hash}` : undefined;
  } catch { return undefined; }
}
