import type { JSHandle, Locator } from "playwright";
import {
  keyboardTextEntryInputModalityId,
  nextItemMoveKindId as nextItem,
  nextStopMoveKindId as nextStop,
  pointAtMoveKindId as pointAt,
  pointerInputModalityId,
  previousItemMoveKindId as previousItem,
  previousStopMoveKindId as previousStop,
  type InputModalityDecision,
  type ResolvedAccessibleLocator,
  type ResolvedTransitionMaterialization,
  type TransitionPlanOperation
} from "@openuji/journey-execution-model";
import type { DiscoveredMaterializationStep, DiscoveryFinding } from "@openuji/journey-plugin";
import { PlaywrightFocus, deepActiveElement, focusedObject } from "./focus.js";
import { pollUntil } from "./locators.js";
import type { PlaywrightStepPerformer, PlaywrightStepPerformerOptions } from "./materialization.js";
import { noPlaywrightTransientUi, playwrightTransientUiPresent } from "./transient.js";

/**
 * Discovery is an authoring aid and never part of a test run. When the model declares no
 * materialization for a transition, it finds a path with the configured keys to the bound
 * object, takes the transition so the journey goes on, and reports the path as a proposal.
 * The author reviews the proposal and declares it in the model. Only then does a run perform it.
 *
 * It is Web-only by construction: it walks the browser's sequential focus order (Tab), WAI-ARIA
 * composite widgets and aria-activedescendant. Native platforms have no counterpart here.
 */

/** The discovery mode of `playwrightDiscoveryExecutor`, which the plugin builds only for `journey-mesh discover`. */
export type PlaywrightDiscovery = Readonly<{
  /** Receives one finding for each transition the discovery run performs. */
  record(finding: DiscoveryFinding): Promise<void> | void;
  /** Find a new path also where the model declares one, and name the declared one as replaced. */
  rediscover?: boolean;
  /** The most focus moves a walk tries in one direction. Default 150. */
  maxStops?: number;
  /** The most item moves (arrow keys) inside a composite widget. Default 30. */
  maxItems?: number;
  /** The pause after each key, so the page can react. Default 100 ms. */
  settleMs?: number;
  /** How long focus must stay put before a walk is measured. Default 500 ms. */
  quietMs?: number;
}>;

/** Item roles whose items are reached with arrow keys inside their container, not with Tab. */
const compositeContainers: Readonly<Record<string, readonly string[]>> = {
  tab: ["tablist"],
  menuitem: ["menu", "menubar"],
  menuitemcheckbox: ["menu", "menubar"],
  menuitemradio: ["menu", "menubar"],
  option: ["listbox"],
  treeitem: ["tree", "treegrid"],
  radio: ["radiogroup"]
};

type Walk = { count?: number; passed: string[]; first?: JSHandle<Element | null> };
type Search =
  | { found: true; moveKindId: string; count: number; passed: string[]; note?: string }
  | { found: false; passed: string[]; note: string };
export type PlaywrightFoundPath =
  | Readonly<{ found: true; moves: readonly string[]; start: string; passed: readonly string[]; note?: string }>
  | Readonly<{ found: false; start: string; passed: readonly string[]; note: string }>;

export type PlaywrightPathFinderOptions = Pick<PlaywrightStepPerformerOptions, "page" | "keyboard" | "transientUi" | "timeoutMs" | "signal">;

/**
 * Walks focus with the keys of the executor's keyboard table and measures each walk. It never
 * calls focus() or click(): a path it reports is one a keyboard user can take.
 */
export class PlaywrightPathFinder {
  private readonly focus: PlaywrightFocus;
  private readonly maxStops: number;
  private readonly maxItems: number;
  private readonly settleMs: number;
  private readonly quietMs: number;

  constructor(private readonly options: PlaywrightPathFinderOptions, discovery: Omit<PlaywrightDiscovery, "record"> = {}) {
    this.focus = new PlaywrightFocus(options.page);
    this.maxStops = discovery.maxStops ?? 150;
    this.maxItems = discovery.maxItems ?? 30;
    this.settleMs = discovery.settleMs ?? 100;
    this.quietMs = discovery.quietMs ?? 500;
  }

  /**
   * The moves from the current focus to `target`: the shorter of the forward and backward walk.
   * A text field is matched by DOM focus, any other object by the object the user is at. Items
   * of a tab list, menu, listbox, tree or radio group are reached by walking into their container,
   * then with item moves. When a path is found, the user ends at the target.
   */
  async findPath(target: Locator, field: boolean): Promise<PlaywrightFoundPath> {
    await this.awaitTransientUi();
    await this.awaitFocusSettled();
    const focus = field ? "dom" : "object";
    const start = await this.focus.describeFocus(focus);
    const arrived = () => this.focus.focusMatches(target, focus);
    if (await arrived()) return { found: true, moves: [], start, passed: [] };
    const container = field ? undefined : await this.compositeContainer(target);
    if (container) {
      try {
        const stops = await this.search(nextStop, previousStop, this.maxStops, () => this.focusInside(container));
        if (!stops.found) return { found: false, start, passed: stops.passed.slice(-12), note: `focus never entered the widget that contains the object: ${stops.note}` };
        const items = await this.search(nextItem, previousItem, this.maxItems, arrived);
        const passed = [...stops.passed, ...items.passed].slice(-12);
        if (!items.found) return { found: false, start, passed, note: `inside its widget: ${items.note}` };
        const note = [stops.note, items.note].filter(Boolean).join("; ");
        return { found: true, moves: [...repeated(stops), ...repeated(items)], start, passed, ...(note ? { note } : {}) };
      } finally {
        await container.dispose();
      }
    }
    const stops = await this.search(nextStop, previousStop, this.maxStops, arrived);
    if (!stops.found) return { found: false, start, passed: stops.passed.slice(-12), note: stops.note };
    return { found: true, moves: repeated(stops), start, passed: stops.passed.slice(-12), ...(stops.note ? { note: stops.note } : {}) };
  }

  /**
   * Walk forward until `arrived`, then measure the backward walk from the same start for a shorter
   * one. A walk is retraced with the opposite move, and the start is checked after each retrace.
   * When focus cannot return to the start, the backward count is taken around the cycle instead.
   */
  private async search(forward: string, backward: string, max: number, arrived: () => Promise<boolean>): Promise<Search> {
    if (await arrived()) return { found: true, moveKindId: forward, count: 0, passed: [] };
    const start = await this.options.page.evaluateHandle(focusedObject);
    const ahead = await this.walk(forward, max, arrived, true);
    try {
      if (ahead.count === undefined) return { found: false, passed: ahead.passed, note: `${max} ${forward} moves did not reach it` };
      if (ahead.count === 1) return { found: true, moveKindId: forward, count: 1, passed: ahead.passed };
      await this.repeat(backward, ahead.count);
      if (!await this.focus.focusIs(start)) return await this.aroundCycle(forward, backward, ahead, await start.evaluate((value) => value === null), max, arrived);
      const behind: Walk = await this.walk(backward, ahead.count - 1, arrived);
      if (behind.count !== undefined) return { found: true, moveKindId: backward, count: behind.count, passed: behind.passed };
      await this.repeat(forward, ahead.count - 1);
      if (!await this.focus.focusIs(start)) return await this.resume(forward, ahead, max, arrived, `${forward} did not retrace the ${backward} walk, so only ${forward} was measured`);
      await this.repeat(forward, ahead.count);
      if (!await arrived()) return { found: false, passed: ahead.passed, note: `${ahead.count} ${forward} moves reached it once, but not a second time` };
      return { found: true, moveKindId: forward, count: ahead.count, passed: ahead.passed };
    } finally {
      await start.dispose();
      await ahead.first?.dispose();
    }
  }

  /**
   * Focus cannot return to where the walk started. That happens when the start is outside the
   * order (`main`, or the document itself), or when the page changed. The order is a cycle, so
   * going on forward from the object until the walk's first stop takes as many moves as the
   * backward walk from the start. The exception: when the start is the document and the cycle
   * passes through it just before that first stop, the backward walk is one move shorter.
   */
  private async aroundCycle(forward: string, backward: string, ahead: Walk, startIsDocument: boolean, max: number, arrived: () => Promise<boolean>): Promise<Search> {
    const lost = `${backward} did not retrace the ${forward} walk`;
    if ((await this.walk(forward, max, arrived)).count === undefined) return { found: false, passed: ahead.passed, note: `${lost}, and focus did not reach the object again` };
    const forwardOnly = (note: string): Search => ({ found: true, moveKindId: forward, count: ahead.count!, passed: ahead.passed, note: `${lost}; ${note}` });
    if (!ahead.first) return forwardOnly(`only ${forward} was measured`);
    const around: string[] = [];
    let documentBeforeFirst = false, reached = false;
    for (let count = 1; count <= max && !reached; count++) {
      await this.press(forward);
      if (await this.focus.focusIs(ahead.first)) reached = true;
      else { documentBeforeFirst = !await this.focus.hasFocus(); around.push(await this.focus.describeFocus()); }
    }
    if (!reached) {
      if ((await this.walk(forward, max, arrived)).count === undefined) return { found: false, passed: ahead.passed, note: `${lost}, and focus did not reach the object again` };
      return forwardOnly(`only ${forward} was measured, because ${forward} does not cycle back to its first stop`);
    }
    // From the document, the backward walk starts at the stop before it, not at the document again.
    const crossed = startIsDocument && documentBeforeFirst ? around.slice(0, -1) : around;
    const behind = crossed.length + 1;
    await this.repeat(forward, ahead.count! - 1);
    if (!await arrived()) {
      if ((await this.walk(forward, max, arrived)).count === undefined) return { found: false, passed: ahead.passed, note: `${lost}, and focus did not reach the object again` };
      return forwardOnly(`only ${forward} was measured, because the walk did not repeat`);
    }
    if (behind >= ahead.count!) return forwardOnly(`${backward} was counted around the cycle (${behind} moves), and the ${forward} walk is shorter`);
    const passed = [...crossed].reverse().concat(ahead.passed.at(-1)!).slice(-12);
    return { found: true, moveKindId: backward, count: behind, passed, note: `${lost}; ${backward} was counted around the cycle, going on with ${forward} from the object to the walk's first stop` };
  }

  /** The start is lost: the measured forward walk stands, and focus goes on forward to the target. */
  private async resume(forward: string, ahead: Walk, max: number, arrived: () => Promise<boolean>, note: string): Promise<Search> {
    if ((await this.walk(forward, max, arrived)).count === undefined) return { found: false, passed: ahead.passed, note: `${note}, and focus did not reach the object again` };
    return { found: true, moveKindId: forward, count: ahead.count!, passed: ahead.passed, note };
  }

  /** Move until `arrived`; `keepFirst` keeps a handle to the first stop, which the caller disposes. */
  private async walk(kind: string, max: number, arrived: () => Promise<boolean>, keepFirst = false): Promise<Walk> {
    const passed: string[] = [];
    let first: JSHandle<Element | null> | undefined;
    for (let count = 1; count <= max; count++) {
      await this.press(kind);
      if (keepFirst && count === 1) first = await this.options.page.evaluateHandle(focusedObject);
      passed.push(await this.focus.describeFocus());
      if (await arrived()) return { count, passed, ...(first ? { first } : {}) };
    }
    return { passed, ...(first ? { first } : {}) };
  }

  /**
   * An application often moves focus a moment after a transition: a dialog focuses its first
   * field, or a closing menu drops focus. Measure only once focus has stayed put for `quietMs`.
   */
  private async awaitFocusSettled(): Promise<void> {
    const { page } = this.options;
    const deadline = Date.now() + this.options.timeoutMs;
    let previous = await page.evaluateHandle(focusedObject);
    let stableSince = Date.now();
    try {
      while (Date.now() - stableSince < this.quietMs && Date.now() < deadline) {
        this.options.signal?.throwIfAborted();
        await page.waitForTimeout(50);
        if (await this.focus.focusIs(previous)) continue;
        await previous.dispose();
        previous = await page.evaluateHandle(focusedObject);
        stableSince = Date.now();
      }
    } finally {
      await previous.dispose();
    }
  }

  private async repeat(kind: string, count: number): Promise<void> {
    for (let index = 0; index < count; index++) await this.press(kind);
  }

  private async press(kind: string): Promise<void> {
    this.options.signal?.throwIfAborted();
    const key = await this.focus.keyFor(this.options.keyboard.moves[kind], `moves["${kind}"]`, "Discovery");
    await this.options.page.keyboard.press(key);
    await this.options.page.waitForTimeout(this.settleMs);
  }

  /** Walks are measured without the interface the suite declared transient, as runs perform them. */
  private async awaitTransientUi(): Promise<void> {
    const transientUi = this.options.transientUi ?? noPlaywrightTransientUi;
    if (!transientUi.length) return;
    await pollUntil(() => playwrightTransientUiPresent(this.options.page, transientUi), {
      message: "Discovery starts once the transientUi declared for this executor has expired", timeoutMs: this.options.timeoutMs, signal: this.options.signal
    });
  }

  /** The tab list, menu, listbox, tree or radio group around a target with an item role. */
  private async compositeContainer(target: Locator): Promise<JSHandle<Element> | undefined> {
    for (const [role, containers] of Object.entries(compositeContainers)) {
      if (await this.options.page.getByRole(role as Parameters<typeof this.options.page.getByRole>[0]).and(target).count() === 0) continue;
      const element = await target.elementHandle({ timeout: this.options.timeoutMs });
      if (!element) return undefined;
      try {
        const container = await element.evaluateHandle((item, roles) => item.closest(roles.map((name) => `[role="${name}"]`).join(",")), [...containers]);
        if (await container.evaluate((value) => value !== null)) return container as JSHandle<Element>;
        await container.dispose();
        return undefined;
      } finally {
        await element.dispose();
      }
    }
    return undefined;
  }

  /**
   * Focus is in the widget when the object the user is at lies inside it, or when the focused
   * element (or its combobox) controls or owns it, as a combobox controls its listbox.
   */
  private async focusInside(container: JSHandle<Element>): Promise<boolean> {
    const object = await this.options.page.evaluateHandle(focusedObject);
    const dom = await this.options.page.evaluateHandle(deepActiveElement);
    try {
      return await this.options.page.evaluate(([widget, at, focused]) => {
        if (at && widget.contains(at)) return true;
        if (!focused || !widget.id) return false;
        for (const owner of [focused, focused.closest('[role="combobox"]')]) {
          const named = `${owner?.getAttribute("aria-controls") ?? ""} ${owner?.getAttribute("aria-owns") ?? ""}`.split(/\s+/);
          if (named.includes(widget.id)) return true;
        }
        return false;
      }, [container, object, dom] as const);
    } finally {
      await object.dispose();
      await dom.dispose();
    }
  }
}

function repeated(search: Extract<Search, { found: true }>): string[] {
  return Array.from({ length: search.count }, () => search.moveKindId);
}

/** The bound object as one locator a step can name, when the binding has exactly one. */
export function boundLocator(operation: TransitionPlanOperation): ResolvedAccessibleLocator | undefined {
  const bindings = operation.activation.bindings;
  return bindings.length === 1 && bindings[0].locators.length === 1 ? bindings[0].locators[0] : undefined;
}

export type DiscoverTransitionInput = Readonly<{
  operation: TransitionPlanOperation;
  decision: InputModalityDecision;
  /** The bound object, already checked to match exactly once. */
  target: Locator;
  /** The value a text-entry transition types. */
  text?: string;
  finder: PlaywrightPathFinder;
  /** Takes the transition once the path is found, exactly as a declared one is performed. */
  performer: PlaywrightStepPerformer;
  discovery: PlaywrightDiscovery;
  /** The declared materialization being rediscovered. */
  replaces?: string;
}>;

/**
 * Find a path for one transition, take the transition, and report the path. When no path is
 * found, the report says why, and the transition fails, because the journey cannot go on.
 */
export async function discoverTransition({ operation, decision, target, text, finder, performer, discovery, replaces }: DiscoverTransitionInput): Promise<void> {
  const modalityId = decision.modality.id;
  const transitionId = operation.transition.id;
  const base = {
    profileId: decision.profileId, operationId: operation.id, transitionId,
    ...(operation.transition.label ? { transitionLabel: operation.transition.label } : {}),
    modalityId, ...(replaces ? { replaces } : {})
  };
  const locator = boundLocator(operation);
  const notFound = async (note: string, start?: string, passed?: readonly string[]): Promise<never> => {
    await discovery.record({ ...base, status: "not-found", note, ...(start ? { start } : {}), ...(passed?.length ? { passed } : {}) });
    throw new Error(`Transition ${transitionId}: discovery found no ${modalityId} path: ${note}`);
  };

  if (modalityId === pointerInputModalityId) {
    if (!locator) return notFound("the transition's ObservationBinding names more than one locator, so no single object can be pointed at; declare the pointer steps");
    const steps: DiscoveredMaterializationStep[] = [{ kind: "move", moveKindId: pointAt, locatorId: locator.id }, { kind: "activation" }];
    await performer.perform(resolved(operation, decision, steps, locator));
    await discovery.record({ ...base, status: "found", steps });
    return;
  }

  const field = modalityId === keyboardTextEntryInputModalityId;
  const path = await finder.findPath(target, field);
  if (!path.found) return notFound(path.note, path.start, path.passed);
  const moves: DiscoveredMaterializationStep[] = path.moves.map((moveKindId, index) => ({
    kind: "move", moveKindId, ...(locator && index === path.moves.length - 1 ? { locatorId: locator.id } : {})
  }));
  const review = { start: path.start, ...(path.passed.length ? { passed: path.passed } : {}), ...(path.note ? { note: path.note } : {}) };
  if (field) {
    await performer.typeAtFocus(target, text ?? "", `Transition ${transitionId}`);
    await discovery.record(moves.length ? { ...base, status: "found", steps: moves, ...review } : { ...base, status: "at-target", ...review });
    return;
  }
  // The activation checks that the user is at the bound object, then uses the table's key.
  await performer.perform(resolved(operation, decision, [{ kind: "activation", ...(locator ? { locatorId: locator.id } : {}) }], locator));
  const steps: DiscoveredMaterializationStep[] = [...moves, { kind: "activation", ...(locator && !moves.length ? { locatorId: locator.id } : {}) }];
  await discovery.record({ ...base, status: "found", steps, ...review });
}

/** A materialization for the performer, in memory only; its IRIs never reach a model. */
function resolved(
  operation: TransitionPlanOperation,
  decision: InputModalityDecision,
  steps: readonly DiscoveredMaterializationStep[],
  locator: ResolvedAccessibleLocator | undefined
): ResolvedTransitionMaterialization {
  const id = `urn:openuji:discovery:${operation.id}`;
  return {
    id, transitionId: operation.transition.id, modality: decision.modality,
    steps: steps.map((step, index) => ({
      id: `${id}:${index + 1}`,
      kind: step.kind,
      ...(step.kind === "move" ? { moveKind: { id: step.moveKindId, type: step.moveKindId === pointAt ? "move" as const : "focus" as const } } : {}),
      ...(step.locatorId && locator ? { locator } : {})
    }))
  };
}
