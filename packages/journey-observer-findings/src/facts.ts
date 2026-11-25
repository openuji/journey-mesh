/**
 * Reads facts about elements and focus. Every read is passive: no scrolling, focusing or hovering, so
 * observing never changes what the next operation sees.
 */
import { PlaywrightFocus, type PlaywrightFailureObservation, type toPlaywrightLocator } from "@openuji/journey-executor-playwright/observation";
import { parse as parseYaml } from "yaml";
import { normalizedName, type ElementFact, type FindingBox } from "./evidence.js";

export type Page = PlaywrightFailureObservation["page"];
export type Locator = Awaited<ReturnType<typeof toPlaywrightLocator>>;
export type Viewport = Readonly<{ width: number; height: number }>;

/** Bound on every single read, so a capture never holds a run for long. */
export const readTimeoutMs = 2_000;
const markupLength = 600;

export async function viewportOf(page: Page): Promise<Viewport> {
  return page.viewportSize() ?? await page.evaluate("({ width: innerWidth, height: innerHeight })") as Viewport;
}

/** The fact of one element (`locator` must resolve to exactly one). */
export async function describe(page: Page, one: Locator, viewport: Viewport, matches = 1): Promise<ElementFact> {
  const visible = await one.isVisible();
  const raw = visible ? await one.boundingBox({ timeout: readTimeoutMs }).catch(() => null) : null;
  const box: FindingBox | undefined = raw ? { x: round(raw.x), y: round(raw.y), width: round(raw.width), height: round(raw.height) } : undefined;
  const accessible = await accessibleOf(page, one);
  const markup = await one.evaluate((element) => element.outerHTML, undefined, { timeout: readTimeoutMs }).catch(() => undefined);
  return Object.freeze({
    matches, visible, ...accessible,
    ...(box ? { box } : {}),
    inViewport: !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
    ...(markup ? { markup: markup.slice(0, markupLength) } : {})
  });
}

/** The focused object's fact, or null when the document has focus. */
export async function focusFact(page: Page, viewport: Viewport): Promise<ElementFact | null> {
  const focused = await new PlaywrightFocus(page).focusLocator("object");
  // `*:focus` also matches a shadow host around the focused element; the innermost match comes last.
  return focused ? describe(page, focused.last(), viewport) : null;
}

/** Whether the focused object is the (single) element `target` names. */
export async function focusIs(page: Page, target: Locator): Promise<boolean> {
  return new PlaywrightFocus(page).focusMatches(target, "object");
}

/**
 * Role, accessible name and states from the first line of `ariaSnapshot()`, kept only when they are the
 * element's own: a wrapper without a role reports its first child, which must not be mistaken for it.
 */
async function accessibleOf(page: Page, one: Locator): Promise<Pick<ElementFact, "role" | "name" | "states">> {
  const snapshot = await one.ariaSnapshot({ timeout: readTimeoutMs }).catch(() => "");
  const parsed = parseAriaSnapshotHead(snapshot);
  if (!parsed) return {};
  try {
    const own = page.getByRole(parsed.role as Parameters<Page["getByRole"]>[0], parsed.name === undefined ? {} : { name: parsed.name, exact: true });
    if (await own.and(one).count() !== 1) return {};
  } catch { return {}; }
  return Object.freeze({ role: parsed.role, ...(parsed.name !== undefined ? { name: normalizedName(parsed.name) } : {}), ...(parsed.states.length ? { states: Object.freeze(parsed.states) } : {}) });
}

/** `- button "Save" [disabled]`, or the YAML-quoted form `- 'button "Icon: account"': …`. */
export function parseAriaSnapshotHead(snapshot: string): { role: string; name?: string; states: string[] } | undefined {
  let items: unknown;
  try { items = parseYaml(snapshot); } catch { return undefined; }
  const first = Array.isArray(items) ? items[0] : undefined;
  const head = typeof first === "string" ? first : first && typeof first === "object" ? Object.keys(first)[0] : undefined;
  const match = head?.match(/^([a-z]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]+\])*)$/);
  if (!match || match[1] === "text") return undefined;
  let name: string | undefined;
  if (match[2] !== undefined) {
    try { name = JSON.parse(`"${match[2]}"`) as string; } catch { name = match[2]; }
  }
  const states = [...(match[3] ?? "").matchAll(/\[([^\]]+)\]/g)].map((state) => state[1]!);
  return { role: match[1]!, ...(name !== undefined ? { name } : {}), states };
}

/** How alike two names are, 0 to 1, ignoring case and whitespace runs. */
export function nameSimilarity(left: string, right: string): number {
  const a = normalizedName(left).toLowerCase();
  const b = normalizedName(right).toLowerCase();
  if (!a.length && !b.length) return 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const kept = previous[j]!;
      previous[j] = Math.min(previous[j]! + 1, previous[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = kept;
    }
  }
  return 1 - previous[b.length]! / Math.max(a.length, b.length);
}

export const sameIgnoringWhitespace = (left: string, right: string): boolean =>
  left.replace(/\s+/g, "").toLowerCase() === right.replace(/\s+/g, "").toLowerCase();

const round = (value: number) => Math.round(value * 100) / 100;
