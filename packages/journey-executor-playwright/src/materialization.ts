import type { Locator, Page } from "playwright";
import {
  keyboardInputModalityId,
  keyboardTextEntryInputModalityId,
  pointAtMoveKindId,
  pointerInputModalityId,
  type ResolvedMaterializationStep,
  type ResolvedTransitionMaterialization,
  type TransitionPlanOperation
} from "@openuji/journey-execution-model";
import { describeElement, focusedObject, PlaywrightFocus } from "./focus.js";
import type { PlaywrightKeyboard } from "./keyboard.js";
import { pollUntil, toPlaywrightLocator, validatePlaywrightLocator } from "./locators.js";
import { noPlaywrightTransientUi, playwrightTransientUiPresent, type PlaywrightTransientUi } from "./transient.js";

/**
 * Performs declared UJG RC4 Operability steps (Operability §7). It never places focus
 * programmatically, never chooses among several objects, and never adds a step.
 */

/** Core `extensions` key on a ShortcutStep whose object does not expose its shortcut: `{ "keys": "Control+K" }`. */
export const playwrightShortcutExtension = "urn:openuji:playwright:shortcut";

const performedModalities: readonly string[] = [keyboardInputModalityId, pointerInputModalityId, keyboardTextEntryInputModalityId];

export type PlaywrightStepCommand = "move" | "activate" | "shortcut" | "text-entry";

export type PlaywrightRecordedCommand = Readonly<{
  command: PlaywrightStepCommand;
  materializationId?: string;
  stepId?: string;
}>;

/** Records one executor command around `work`; `work` reports the gesture it uses. */
export type PlaywrightCommandRecorder = (
  command: PlaywrightRecordedCommand,
  work: (gesture: (value: string) => void) => Promise<void>
) => Promise<void>;

/** Where the pointer rests in one page, kept across transitions as a real pointer is. */
export type PlaywrightPointerState = { position?: Readonly<{ x: number; y: number }> };

export type PlaywrightStepPerformerOptions = Readonly<{
  page: Page;
  keyboard: PlaywrightKeyboard;
  /** Interface that expires on its own; a materialization that moves focus waits until none is present. */
  transientUi?: PlaywrightTransientUi;
  pointer: PlaywrightPointerState;
  record: PlaywrightCommandRecorder;
  timeoutMs: number;
  signal?: AbortSignal;
}>;

/** Whether this executor performs transitions through the modality. */
export function playwrightPerformsModality(modalityId: string): boolean {
  return performedModalities.includes(modalityId);
}

/**
 * Preflight: every materialization this executor could be asked to perform must be
 * performable here. Materializations through other modalities belong to other executors.
 */
export function validatePlaywrightMaterializations(operation: TransitionPlanOperation, keyboard: PlaywrightKeyboard): void {
  for (const materialization of operation.materializations ?? []) {
    const modality = materialization.modality.id;
    if (!playwrightPerformsModality(modality)) continue;
    if (materialization.startLocator) validatePlaywrightLocator(materialization.startLocator);
    for (const step of materialization.steps) {
      const where = stepLabel(materialization, step);
      if (step.locator) validatePlaywrightLocator(step.locator);
      if (step.kind === "move") {
        if (!step.moveKind) throw new Error(`${where}: a MoveStep without stepMoveKindRef cannot be performed`);
        if (modality === pointerInputModalityId) {
          if (step.moveKind.id !== pointAtMoveKindId) throw new Error(`${where}: Playwright does not support ${step.moveKind.id} through ${modality}`);
          if (!step.locator) throw new Error(`${where}: an operability:pointAt MoveStep must name its object with stepLocatorRef`);
        } else {
          if (step.moveKind.type !== "focus") throw new Error(`${where}: Playwright does not support ${step.moveKind.id} through ${modality}; only focus moves are performed`);
          if (!Object.hasOwn(keyboard.moves, step.moveKind.id)) throw new Error(`${where}: no key for ${step.moveKind.id}; set executors.<name>.options.keyboard.moves["${step.moveKind.id}"]`);
        }
      } else if (modality === keyboardTextEntryInputModalityId) {
        throw new Error(`${where}: a text-entry materialization only reaches the field with focus moves; ${step.kind} steps are not supported`);
      } else if (step.kind === "shortcut") {
        if (modality !== keyboardInputModalityId) throw new Error(`${where}: Playwright performs ShortcutSteps only through ${keyboardInputModalityId}`);
        const hint = shortcutHint(step, where);
        if (!step.locator && !hint) throw new Error(`${where}: a ShortcutStep needs an object that exposes its shortcut (stepLocatorRef) or a ${playwrightShortcutExtension} extension`);
      }
    }
  }
}

export class PlaywrightStepPerformer {
  private readonly focus: PlaywrightFocus;

  constructor(private readonly options: PlaywrightStepPerformerOptions) {
    this.focus = new PlaywrightFocus(options.page);
  }

  /** Perform every step in declared order, checking each as Operability §7 requires. */
  async perform(materialization: ResolvedTransitionMaterialization): Promise<void> {
    const pointer = materialization.modality.id === pointerInputModalityId;
    if (!pointer) await this.awaitTransientUiGone(materialization);
    if (materialization.startLocator) await this.checkStart(materialization, pointer);
    for (const step of materialization.steps) {
      this.options.signal?.throwIfAborted();
      const where = stepLabel(materialization, step);
      const command: PlaywrightStepCommand = step.kind === "move" ? "move" : step.kind === "activation" ? "activate" : "shortcut";
      await this.options.record({ command, materializationId: materialization.id, stepId: step.id }, async (gesture) => {
        if (step.kind === "move") return pointer ? this.pointAt(step, where, gesture) : this.moveFocus(step, where, gesture);
        if (step.kind === "activation") return pointer ? this.pointerActivate(step, where, gesture) : this.keyboardActivate(step, where, gesture);
        return this.shortcut(step, where, gesture);
      });
    }
  }

  /** Type at the focused object, which must be the transition's bound field. Never moves focus itself. */
  async typeAtFocus(field: Locator, text: string, where: string, materializationId?: string): Promise<void> {
    await this.options.record({ command: "text-entry", ...(materializationId ? { materializationId } : {}) }, async (gesture) => {
      await this.poll(
        `${where}: text entry types at the focused object, which must match the transition's ObservationBinding; declare focus moves that reach the field`,
        async () => await this.focus.focusMatches(field, "dom") ? "ok" : `focus is at ${await this.focus.describeFocus("dom")}`
      );
      gesture("type");
      await this.options.page.keyboard.type(text);
    });
  }

  /**
   * A focus walk crosses the tab stops of whatever is on the page, so it starts only once the
   * interface the suite declared transient has expired. Only walks are affected: activation and
   * shortcuts act at the current focus and do not count stops. Never dismisses anything.
   */
  private async awaitTransientUiGone(materialization: ResolvedTransitionMaterialization): Promise<void> {
    const transientUi = this.options.transientUi ?? noPlaywrightTransientUi;
    if (transientUi.length === 0 || !materialization.steps.some((step) => step.kind === "move")) return;
    await this.poll(
      `Materialization ${materialization.id}: its focus moves start once the transientUi declared for this executor has expired`,
      async () => await playwrightTransientUiPresent(this.options.page, transientUi)
    );
  }

  private async checkStart(materialization: ResolvedTransitionMaterialization, pointer: boolean): Promise<void> {
    const start = materialization.startLocator!;
    const target = await toPlaywrightLocator(this.options.page, start);
    await this.poll(`Materialization ${materialization.id}: the user must start at ${start.id}`, async () => pointer
      ? await this.pointerMatches(target) ? "ok" : `pointer is at ${await this.describePointer()}`
      : await this.focus.focusMatches(target) ? "ok" : `focus is at ${await this.focus.describeFocus()}`);
  }

  private async moveFocus(step: ResolvedMaterializationStep, where: string, gesture: (value: string) => void): Promise<void> {
    const { page } = this.options;
    const kind = step.moveKind!.id;
    const key = await this.focus.keyFor(this.options.keyboard.moves[kind], `moves["${kind}"]`, where);
    const from = await this.focus.describeFocus();
    gesture(key);
    const before = await page.evaluateHandle(focusedObject);
    try {
      await page.keyboard.press(key);
      const target = step.locator ? await toPlaywrightLocator(page, step.locator) : undefined;
      await this.poll(`${where} (MoveStep ${kind} via ${key} from ${from})`, async () => {
        if (await this.focus.focusIs(before)) return "focus did not move";
        if (!target) return "ok";
        return await this.focus.focusMatches(target) ? "ok" : `focus is at ${await this.focus.describeFocus()}, expected ${step.locator!.id}`;
      });
    } finally {
      await before.dispose();
    }
  }

  private async keyboardActivate(step: ResolvedMaterializationStep, where: string, gesture: (value: string) => void): Promise<void> {
    if (step.locator) {
      const target = await toPlaywrightLocator(this.options.page, step.locator);
      await this.poll(`${where} (ActivationStep): the user must be at ${step.locator.id}`, async () => await this.focus.focusMatches(target) ? "ok" : `focus is at ${await this.focus.describeFocus()}`);
    } else if (!await this.focus.hasFocus()) {
      throw new Error(`${where} (ActivationStep): no object has focus`);
    }
    const key = await this.focus.keyFor(this.options.keyboard.activation, "activation", where);
    gesture(key);
    await this.options.page.keyboard.press(key);
  }

  private async pointAt(step: ResolvedMaterializationStep, where: string, gesture: (value: string) => void): Promise<void> {
    const { page, pointer } = this.options;
    const locator = step.locator!;
    const target = await toPlaywrightLocator(page, locator);
    await this.poll(`${where} (MoveStep ${pointAtMoveKindId}): ${locator.id} must match exactly one object`, async () => {
      const count = await target.count();
      return count === 1 ? "ok" : `${count} objects match; the runner never chooses one`;
    });
    await target.scrollIntoViewIfNeeded({ timeout: this.options.timeoutMs });
    const box = await target.boundingBox({ timeout: this.options.timeoutMs });
    if (!box) throw new Error(`${where} (MoveStep ${pointAtMoveKindId}): ${locator.id} has no box to point at`);
    const position = Object.freeze({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    gesture("pointer-move");
    await page.mouse.move(position.x, position.y);
    pointer.position = position;
    await this.poll(`${where} (MoveStep ${pointAtMoveKindId}): the pointer must be at ${locator.id}`, async () => await this.pointerMatches(target) ? "ok" : `pointer is at ${await this.describePointer()}`);
  }

  private async pointerActivate(step: ResolvedMaterializationStep, where: string, gesture: (value: string) => void): Promise<void> {
    if (!this.options.pointer.position) throw new Error(`${where} (ActivationStep): the pointer position is unknown; reach the object with an operability:pointAt MoveStep first`);
    if (step.locator) {
      const target = await toPlaywrightLocator(this.options.page, step.locator);
      await this.poll(`${where} (ActivationStep): the pointer must be at ${step.locator.id}`, async () => await this.pointerMatches(target) ? "ok" : `pointer is at ${await this.describePointer()}`);
    }
    gesture("pointer-press");
    await this.options.page.mouse.down();
    await this.options.page.mouse.up();
  }

  private async shortcut(step: ResolvedMaterializationStep, where: string, gesture: (value: string) => void): Promise<void> {
    let keys = shortcutHint(step, where);
    if (step.locator) {
      const target = await toPlaywrightLocator(this.options.page, step.locator);
      await this.poll(`${where} (ShortcutStep): ${step.locator.id} must match exactly one object`, async () => {
        const count = await target.count();
        return count === 1 ? "ok" : `${count} objects match`;
      });
      // aria-keyshortcuts lists alternatives separated by spaces; the first is performed.
      keys ??= (await target.getAttribute("aria-keyshortcuts", { timeout: this.options.timeoutMs }))?.trim().split(/\s+/)[0] || undefined;
    }
    if (!keys) throw new Error(`${where} (ShortcutStep): ${step.locator?.id ?? "the step"} exposes no aria-keyshortcuts and the step has no ${playwrightShortcutExtension} extension`);
    gesture(keys);
    await this.options.page.keyboard.press(keys);
  }

  /**
   * The pointer is at an object when the topmost object under it is that object or inside it.
   * The target resolves to handles first, so no selector engine runs in the page's own world.
   */
  private async pointerMatches(target: Locator): Promise<boolean> {
    const position = this.options.pointer.position;
    if (!position) return false;
    const elements = await target.elementHandles();
    try {
      return await this.options.page.evaluate(({ point, candidates }) => {
        let hit: Element | null = document.elementFromPoint(point.x, point.y);
        while (hit?.shadowRoot) {
          const inner: Element | null = hit.shadowRoot.elementFromPoint(point.x, point.y);
          if (!inner || inner === hit) break;
          hit = inner;
        }
        for (let node: Node | null = hit; node; node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)) {
          if ((candidates as Node[]).includes(node)) return true;
        }
        return false;
      }, { point: position, candidates: elements });
    } finally {
      await Promise.all(elements.map((element) => element.dispose()));
    }
  }

  private async describePointer(): Promise<string> {
    const position = this.options.pointer.position;
    if (!position) return "an unknown position";
    const hit = await this.options.page.evaluateHandle((point) => document.elementFromPoint(point.x, point.y), position);
    try { return await hit.evaluate(describeElement) ?? "no object"; }
    finally { await hit.dispose(); }
  }

  private async poll(message: string, check: () => Promise<string>): Promise<void> {
    await pollUntil(check, { message, timeoutMs: this.options.timeoutMs, signal: this.options.signal });
  }
}

function stepLabel(materialization: ResolvedTransitionMaterialization, step: ResolvedMaterializationStep): string {
  return `Materialization ${materialization.id} step ${step.id}`;
}

function shortcutHint(step: ResolvedMaterializationStep, where: string): string | undefined {
  const hint = step.extensions?.[playwrightShortcutExtension];
  if (hint === undefined) return undefined;
  const keys = hint && typeof hint === "object" && !Array.isArray(hint) ? (hint as Record<string, unknown>).keys : undefined;
  if (typeof keys !== "string" || !keys.trim()) throw new Error(`${where}: ${playwrightShortcutExtension} must be an object with a nonempty keys string`);
  return keys;
}
