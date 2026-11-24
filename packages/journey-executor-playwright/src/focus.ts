import type { JSHandle, Locator, Page } from "playwright";
import { anyRole, resolveKey, type PlaywrightKeyBinding } from "./keyboard.js";

/**
 * Reads where the user is in a page: the object the accessibility API reports as focused, or the
 * element keys go to. It never moves focus. The step performer and the path finder share it.
 */
export class PlaywrightFocus {
  constructor(private readonly page: Page) {}

  /** The key a binding names for the focused object's role, tested with Playwright's role engine. */
  async keyFor(binding: PlaywrightKeyBinding | undefined, path: string, where: string): Promise<string> {
    if (binding === undefined) throw new Error(`${where}: no key for ${path}; set executors.<name>.options.keyboard.${path}`);
    const focused = typeof binding === "string" ? undefined : await this.focusLocator("object");
    const key = await resolveKey(binding, async (role) =>
      focused !== undefined && await this.page.getByRole(role as Parameters<Page["getByRole"]>[0]).and(focused).count() > 0);
    if (key) return key;
    throw new Error(`${where}: no key for ${path} at ${await this.describeFocus()}; name its role or "${anyRole}" in executors.<name>.options.keyboard.${path}`);
  }

  async hasFocus(focus: "object" | "dom" = "object"): Promise<boolean> {
    const focused = await this.page.evaluateHandle(focus === "object" ? focusedObject : deepActiveElement);
    try { return await focused.evaluate((element) => element !== null); }
    finally { await focused.dispose(); }
  }

  async focusIs(previous: JSHandle<Element | null>): Promise<boolean> {
    const focused = await this.page.evaluateHandle(focusedObject);
    try { return await this.page.evaluate(([left, right]) => left === right, [previous, focused] as const); }
    finally { await focused.dispose(); }
  }

  /**
   * Whether the object the user is at (`object`) or the element keys go to (`dom`) matches the target.
   * Matching is a locator count, which Playwright runs in its isolated world: on some pages the
   * role engine fails in the page's own world, where `evaluateAll` runs.
   */
  async focusMatches(target: Locator, focus: "object" | "dom" = "object"): Promise<boolean> {
    const focused = await this.focusLocator(focus);
    return focused !== undefined && await target.and(focused).count() > 0;
  }

  /** A locator for the focused object: the focused element, or the active descendant it names. */
  async focusLocator(focus: "object" | "dom"): Promise<Locator | undefined> {
    if (!await this.hasFocus(focus)) return undefined;
    const descendantId = focus === "object" ? await this.page.evaluate(activeDescendantId) : null;
    return descendantId === null ? this.page.locator("*:focus") : this.page.locator(`[id="${descendantId.replace(/["\\]/g, "\\$&")}"]`);
  }

  /** A diagnostic description of the focused object; never used to decide anything. */
  async describeFocus(focus: "object" | "dom" = "object"): Promise<string> {
    const focused = await this.page.evaluateHandle(focus === "object" ? focusedObject : deepActiveElement);
    try { return await focused.evaluate(describeElement) ?? "the document (no object has focus)"; }
    finally { await focused.dispose(); }
  }
}

// Page functions: self-contained, with no nested named functions, so they serialize into the page.
/** The element with DOM focus, where keys and typed text go. */
export const deepActiveElement = (): Element | null => {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element === null || element === document.body || element === document.documentElement ? null : element;
};

/**
 * The object the user is at, as the accessibility API reports focus: the focused element,
 * or the element its aria-activedescendant names (a combobox or listbox option).
 */
export const focusedObject = (): Element | null => {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  if (element === null || element === document.body || element === document.documentElement) return null;
  const descendantId = element.getAttribute("aria-activedescendant");
  const root = element.getRootNode() as Document | ShadowRoot;
  return (descendantId ? root.getElementById(descendantId) : null) ?? element;
};

/** The id that the focused element's aria-activedescendant names, when that element exists. */
const activeDescendantId = (): string | null => {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  const descendantId = element?.getAttribute("aria-activedescendant");
  if (!element || !descendantId) return null;
  return (element.getRootNode() as Document | ShadowRoot).getElementById(descendantId) ? descendantId : null;
};

export const describeElement = (element: Element | null): string | undefined => {
  if (!element) return undefined;
  const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
  const labelled = element.getAttribute("aria-label")
    ?? (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
      ? element.labels?.[0]?.textContent
      : element.textContent);
  const name = (labelled ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  return name ? `${role} "${name}"` : role;
};
