import type { ResolvedAccessibleLocator, ResolvedObservationBinding } from "@openuji/journey-runner";
import { xpathLiteral } from "./queries.js";

/** Model role identifiers explicitly supported by the XCUITest iOS executor. */
const roles: Readonly<Record<string, readonly string[]>> = Object.freeze({
  button: ["XCUIElementTypeButton"],
  text: ["XCUIElementTypeStaticText"],
  textbox: ["XCUIElementTypeTextField", "XCUIElementTypeSecureTextField", "XCUIElementTypeSearchField"],
  checkbox: ["XCUIElementTypeSwitch", "XCUIElementTypeCheckBox"],
  list: ["XCUIElementTypeCollectionView", "XCUIElementTypeTable"],
  row: ["XCUIElementTypeCell"],
  image: ["XCUIElementTypeImage"],
  navigation: ["XCUIElementTypeNavigationBar", "XCUIElementTypeTabBar"],
  dialog: ["XCUIElementTypeAlert", "XCUIElementTypeSheet"],
  XCUIElementTypeButton: ["XCUIElementTypeButton"],
  XCUIElementTypeStaticText: ["XCUIElementTypeStaticText"],
  XCUIElementTypeTextField: ["XCUIElementTypeTextField"],
  XCUIElementTypeSecureTextField: ["XCUIElementTypeSecureTextField"],
  XCUIElementTypeCell: ["XCUIElementTypeCell"],
  XCUIElementTypeOther: ["XCUIElementTypeOther"]
});

const features: readonly string[] = Object.freeze([
  "name", "label", "value", "placeholderValue", "type", "enabled", "visible", "accessible", "selected", "focused", "hittable"
]);

function predicates(locator: ResolvedAccessibleLocator): readonly string[] {
  if (locator.accessibleDescription !== undefined) {
    throw new Error(`Appium iOS does not support accessibleDescription on ${locator.id}`);
  }
  const types = locator.role === undefined ? undefined : roles[locator.role];
  if (locator.role !== undefined && !types) {
    throw new Error(`Appium iOS does not support role ${locator.role} on ${locator.id}`);
  }
  const role = types ? [`(${types.map((name) => `@type=${xpathLiteral(name)}`).join(" or ")})`] : [];
  const name = locator.accessibleName === undefined ? [] : [
    `(@label=${xpathLiteral(locator.accessibleName)} or @name=${xpathLiteral(locator.accessibleName)} or @value=${xpathLiteral(locator.accessibleName)} or @placeholderValue=${xpathLiteral(locator.accessibleName)})`
  ];
  const attributes = locator.features.flatMap((feature) => {
    if (feature.value === "*") return [];
    if (!features.includes(feature.name)) {
      throw new Error(`Appium iOS does not support AccessibleFeature ${feature.name}`);
    }
    if (["enabled", "visible", "accessible", "selected", "focused", "hittable"].includes(feature.name) && !["true", "false"].includes(feature.value)) {
      throw new Error(`Appium iOS requires a boolean value for ${feature.name}`);
    }
    return [`@${feature.name}=${xpathLiteral(feature.value)}`];
  });
  if (role.length + name.length + attributes.length === 0) {
    throw new Error(`AccessibleLocator ${locator.id} has no executable iOS constraints`);
  }
  return [...role, ...name, ...attributes];
}

function locatorConditions(locator: ResolvedAccessibleLocator, precedingScope = ""): string {
  const scope = locator.contexts.reduce((ancestor, context) =>
    `ancestor::*[${locatorConditions(context, ancestor)}]`, precedingScope);
  return [...predicates(locator), ...(scope ? [scope] : [])].join(" and ");
}

/** Pure XCUITest XPath compilation: conjunction within bindings, union across bindings. */
export function appiumIosLocatorQuery(locator: ResolvedAccessibleLocator): string {
  return `//*[${locatorConditions(locator)} and @visible='true']`;
}

export function appiumIosObservationQuery(bindings: readonly ResolvedObservationBinding[]): string {
  if (bindings.length === 0) throw new Error("Expected at least one iOS ObservationBinding");
  return bindings.map((binding) => {
    if (binding.surfaceInstanceResolver && binding.surfaceInstanceResolver.instanceKeyFeature.value !== "*") {
      throw new Error(`Appium iOS does not support SurfaceInstanceResolver ${binding.surfaceInstanceResolver.id}`);
    }
    if (binding.locators.length === 0) throw new Error(`ObservationBinding ${binding.id} must define a locator`);
    return `//*[${binding.locators.map((locator) => `(${locatorConditions(locator)})`).join(" and ")} and @visible='true']`;
  }).join(" | ");
}
