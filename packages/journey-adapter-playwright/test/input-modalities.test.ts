import assert from "node:assert/strict";
import test from "node:test";
import { activatePlaywrightLocator, playwrightCommandForModality } from "../src/index.js";

test("RC4 modalities map to executable commands without legacy aliases", () => {
  assert.equal(playwrightCommandForModality("observability:keyboard"), "keyboard-activate");
  assert.equal(playwrightCommandForModality("observability:pointer"), "pointer-click");
  assert.equal(playwrightCommandForModality("urn:openuji:input-modality:keyboard-text-entry"), "keyboard-text-entry");
  for (const legacy of ["observability:keyboard-enter", "observability:keyboard-space", "observability:keyboard-text-entry"]) {
    assert.throws(() => playwrightCommandForModality(legacy), /does not support/);
  }
});

test("keyboard activation uses Space for buttons and toggles, and Enter for links and options", async () => {
  for (const [role, nativeToggle, expected] of [["checkbox", false, "Space"], ["radio", false, "Space"], ["switch", false, "Space"], ["button", false, "Space"], ["link", false, "Enter"], ["option", false, "Enter"], [null, true, "Space"]] as const) {
    const keys: string[] = [];
    const locator = {
      async evaluate<T>(fn: (element: { getAttribute(name: string): string | null; matches(selector: string): boolean }) => T) {
        return fn({ getAttribute: () => role, matches: () => nativeToggle });
      },
      async press(key: string) { keys.push(key); }
    };
    await activatePlaywrightLocator(locator as never, "keyboard-activate");
    assert.deepEqual(keys, [expected]);
  }
});

test("producer text entry passes the supplied value through and still requires a value", async () => {
  const typed: string[] = [];
  const locator = { async pressSequentially(value: string) { typed.push(value); } };
  await activatePlaywrightLocator(locator as never, "keyboard-text-entry", "alice");
  assert.deepEqual(typed, ["alice"]);
  await assert.rejects(activatePlaywrightLocator(locator as never, "keyboard-text-entry"), /requires a transition text value/);
});
