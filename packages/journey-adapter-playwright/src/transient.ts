import type { Locator, Page } from "playwright";
import { isPlaywrightRole } from "./locators.js";

/**
 * Interface that removes itself on a timer: toasts, snackbars, banners that fade. While it is
 * on the page its controls sit in the tab order, so how many stops a declared focus walk crosses
 * depends on how long ago something else happened. The option names such objects, and a
 * materialization that moves focus starts only once none is present.
 *
 * It is configuration, not inference: the adapter knows no application's notifications, never
 * dismisses anything, and adds no step. It waits, with the polling and timeout every other
 * assertion uses, and fails naming what never expired.
 */

/** An object found by ARIA role (and exact accessible name), or by a Playwright CSS selector. */
export type PlaywrightTransientObject =
  | Readonly<{ role: string; name?: string }>
  | Readonly<{ css: string }>;

export type PlaywrightTransientUi = readonly PlaywrightTransientObject[];

/** Nothing is transient: a materialization starts as soon as its transition is ready. */
export const noPlaywrightTransientUi: PlaywrightTransientUi = Object.freeze([]);

/** Parse the `transientUi` adapter option: a list of `{ role, name? }` or `{ css }` entries. */
export function parsePlaywrightTransientUi(value: unknown, label = "transientUi"): PlaywrightTransientUi {
  if (value === undefined) return noPlaywrightTransientUi;
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  return Object.freeze(value.map((item, index) => parseObject(item, `${label}[${index}]`)));
}

function parseObject(value: unknown, label: string): PlaywrightTransientObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const entry = value as Record<string, unknown>;
  for (const key of Object.keys(entry)) if (key !== "role" && key !== "name" && key !== "css") throw new Error(`Unknown option ${label}.${key}`);
  if (entry.css !== undefined) {
    if (entry.role !== undefined || entry.name !== undefined) throw new Error(`${label} names either css or a role, not both`);
    if (typeof entry.css !== "string" || !entry.css.trim()) throw new Error(`${label}.css must be a nonempty selector`);
    return Object.freeze({ css: entry.css });
  }
  if (typeof entry.role !== "string" || !isPlaywrightRole(entry.role)) throw new Error(`${label} must name css or an ARIA role Playwright supports`);
  if (entry.name !== undefined && (typeof entry.name !== "string" || !entry.name.trim())) throw new Error(`${label}.name must be a nonempty accessible name`);
  return Object.freeze({ role: entry.role, ...(entry.name === undefined ? {} : { name: entry.name }) });
}

/** `"ok"` when none of the declared objects is on the page, otherwise what is still there. */
export async function playwrightTransientUiPresent(page: Page, transientUi: PlaywrightTransientUi): Promise<string> {
  for (const object of transientUi) {
    const count = await locate(page, object).count();
    if (count > 0) return `${describe(object)} is still present (${count})`;
  }
  return "ok";
}

function locate(page: Page, object: PlaywrightTransientObject): Locator {
  return "css" in object ? page.locator(object.css) : page.getByRole(object.role as never, { name: object.name, exact: object.name === undefined ? undefined : true });
}

function describe(object: PlaywrightTransientObject): string {
  return "css" in object ? `css ${JSON.stringify(object.css)}` : `role ${object.role}${object.name === undefined ? "" : ` named ${JSON.stringify(object.name)}`}`;
}
