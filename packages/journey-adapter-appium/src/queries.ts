import type { ResolvedAccessibleLocator, ResolvedObservationBinding } from "@openuji/journey-runner";

/** These are model vocabulary identifiers explicitly supported by this adapter. */
const roles: Readonly<Record<string, readonly string[]>> = Object.freeze({
  button: ["android.widget.Button", "android.widget.ImageButton"],
  text: ["android.widget.TextView"],
  textbox: ["android.widget.EditText"],
  checkbox: ["android.widget.CheckBox"],
  list: ["androidx.recyclerview.widget.RecyclerView", "android.widget.ListView"],
  "android.view.ViewGroup": ["android.view.ViewGroup"],
  "android.widget.TextView": ["android.widget.TextView"],
  "android.widget.Button": ["android.widget.Button"]
});
const features = new Set(["resource-id", "class", "text", "content-desc", "clickable", "enabled", "selected", "checked"]);

export const touchTapInputModalityId = "urn:openuji:input:touch-tap";
export type AppiumInteractionCommand = "tap";
export function appiumCommandForModality(id: string): AppiumInteractionCommand {
  if (id === touchTapInputModalityId) return "tap";
  throw new Error(`Appium adapter does not support input modality ${id}`);
}

export function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value.split("'").map((part) => `'${part}'`).join(', "\'", ')})`;
}

function predicates(locator: ResolvedAccessibleLocator): readonly string[] {
  if (locator.accessibleDescription !== undefined) throw new Error(`Appium does not support accessibleDescription on ${locator.id}`);
  const classes = locator.role === undefined ? undefined : roles[locator.role];
  if (locator.role !== undefined && !classes) throw new Error(`Appium does not support role ${locator.role} on ${locator.id}`);
  const role = classes ? [`(${classes.map((name) => `@class=${xpathLiteral(name)}`).join(" or ")})`] : [];
  const name = locator.accessibleName === undefined ? [] : [
    `(@content-desc=${xpathLiteral(locator.accessibleName)} or @text=${xpathLiteral(locator.accessibleName)})`
  ];
  const attributes = locator.features.flatMap((feature) => {
    // The execution model uses '*' for an unbound constraint, not a literal match.
    if (feature.value === "*") return [];
    if (!features.has(feature.name)) throw new Error(`Appium does not support AccessibleFeature ${feature.name}`);
    if (["clickable", "enabled", "selected", "checked"].includes(feature.name) && !["true", "false"].includes(feature.value)) {
      throw new Error(`Appium requires a boolean value for ${feature.name}`);
    }
    return [`@${feature.name}=${xpathLiteral(feature.value)}`];
  });
  if (role.length + name.length + attributes.length === 0) throw new Error(`AccessibleLocator ${locator.id} has no executable native constraints`);
  return [...role, ...name, ...attributes];
}

/** Pure query compilation: conjunction within bindings, union across bindings. */
export function appiumLocatorQuery(locator: ResolvedAccessibleLocator): string {
  return `//*[${locatorConditions(locator)} and @displayed='true']`;
}
function locatorConditions(locator: ResolvedAccessibleLocator, precedingScope = ""): string {
  // A context's own contexts must resolve inside the scope established before it.
  const scope = locator.contexts.reduce((ancestor, context) =>
    `ancestor::*[${locatorConditions(context, ancestor)}]`, precedingScope);
  return [...predicates(locator), ...(scope ? [scope] : [])].join(" and ");
}
export function appiumObservationQuery(bindings: readonly ResolvedObservationBinding[]): string {
  if (bindings.length === 0) throw new Error("Expected at least one native ObservationBinding");
  return bindings.map((binding) => {
    if (binding.surfaceInstanceResolver && binding.surfaceInstanceResolver.instanceKeyFeature.value !== "*") {
      throw new Error(`Appium does not support SurfaceInstanceResolver ${binding.surfaceInstanceResolver.id}`);
    }
    if (binding.locators.length === 0) throw new Error(`ObservationBinding ${binding.id} must define a locator`);
    return `//*[${binding.locators.map((locator) => `(${locatorConditions(locator)})`).join(" and ")} and @displayed='true']`;
  }).join(" | ");
}
