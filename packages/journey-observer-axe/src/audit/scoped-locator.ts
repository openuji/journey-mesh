import type { Locator } from "playwright";

import { axeScopeAttribute } from "../constants.js";
import { safeFileSegment } from "../shared/strings.js";

export async function withScopedLocator<T>(
  locator: Locator,
  auditId: string,
  callback: (selector: string) => Promise<T>
): Promise<T> {
  const scopeValue = safeFileSegment(auditId);
  await setLocatorAttribute(locator, axeScopeAttribute, scopeValue);

  try {
    return await callback(`[${axeScopeAttribute}="${scopeValue}"]`);
  } finally {
    await removeLocatorAttribute(locator, axeScopeAttribute);
  }
}

async function setLocatorAttribute(
  locator: Locator,
  attribute: string,
  value: string
): Promise<void> {
  await locator.evaluate(
    (element, [attributeName, attributeValue]) => {
      element.setAttribute(attributeName, attributeValue);
    },
    [attribute, value] as const
  );
}

async function removeLocatorAttribute(locator: Locator, attribute: string): Promise<void> {
  try {
    await locator.evaluate(
      (element, attributeName) => {
        element.removeAttribute(attributeName);
      },
      attribute
    );
  } catch {
    return;
  }
}
