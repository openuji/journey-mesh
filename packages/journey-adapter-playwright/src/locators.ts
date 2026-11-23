import type { Locator, Page } from "playwright";
import type { AccessibleFeature, ResolvedAccessibleLocator, ResolvedObservationBinding } from "@openuji/journey-runner";

export type LocatorRoot = Page | Locator;

const roleOptionFeatureNames = Object.freeze(["expanded", "accessible-name-exact"] as const);

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
  if (locator.extensions) return root.locator(customCssSelector(locator));
  const scopedRoot = await locator.contexts.reduce(
    async (currentRoot, contextLocator) => toPlaywrightLocator(await currentRoot, contextLocator),
    Promise.resolve(root)
  );
  const roleLocator = getRoleLocator(scopedRoot, locator);
  return locator.features
    .filter((feature) => !roleOptionFeatureNames.includes(feature.name as "expanded"))
    .reduce((currentLocator, feature) => applyFeature(currentLocator, feature), roleLocator);
}

function customCssSelector(locator: ResolvedAccessibleLocator): string {
  const extension = locator.extensions;
  const payload = extension?.["urn:openuji:playwright:css"];
  const selector = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>).selector : undefined;
  if (!extension || Object.keys(extension).length !== 1 || typeof selector !== "string" || !selector.trim()) {
    throw new Error(`Unsupported CustomLocator ${locator.id}; expected urn:openuji:playwright:css with a selector object`);
  }
  return selector;
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

export async function assertPlaywrightLocator(
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

export async function pollUntil(
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

export function isPlaywrightRole(role: string): boolean {
  return supportedRoles.includes(role as Parameters<Page["getByRole"]>[0]);
}

/** Reject locators this adapter cannot resolve, before any browser starts. */
export function validatePlaywrightLocator(locator: ResolvedAccessibleLocator): void {
  if (locator.extensions) { customCssSelector(locator); return; }
  if (!locator.role) throw new Error(`AccessibleLocator ${locator.id} does not declare a role`);
  if (!supportedRoles.includes(locator.role as Parameters<Page["getByRole"]>[0])) throw new Error(`Unsupported Playwright role for AccessibleLocator ${locator.id}`);
  if (locator.accessibleDescription) throw new Error(`AccessibleLocator ${locator.id} uses accessibleDescriptionRef, which this adapter does not yet support`);
  expandedOption(locator);
  exactNameOption(locator);
  for (const feature of locator.features) {
    if (!roleOptionFeatureNames.includes(feature.name as (typeof roleOptionFeatureNames)[number]) && feature.value !== "*") throw new Error(`No Playwright adapter for AccessibleFeature ${feature.name}`);
  }
  locator.contexts.forEach(validatePlaywrightLocator);
}

export function validatePlaywrightBindings(bindings: readonly ResolvedObservationBinding[]): void {
  if (!bindings.length) throw new Error("Expected at least one ObservationBinding");
  for (const binding of bindings) {
    if (binding.surfaceInstanceResolver && binding.surfaceInstanceResolver.instanceKeyFeature.value !== "*") {
      throw new Error(`Playwright does not support SurfaceInstanceResolver ${binding.surfaceInstanceResolver.id}`);
    }
    if (!binding.locators.length) throw new Error(`ObservationBinding ${binding.id} must define at least one locator`);
    binding.locators.forEach(validatePlaywrightLocator);
  }
}
