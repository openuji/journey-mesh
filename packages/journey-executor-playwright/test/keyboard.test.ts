import assert from "node:assert/strict";
import test from "node:test";
import { defaultPlaywrightKeyboard, parsePlaywrightKeyboard, resolveKey } from "../src/index.js";

const roles = (...present: string[]) => async (role: string) => present.includes(role);

test("the default keyboard follows WAI-ARIA conventions and is frozen", async () => {
  assert.equal(defaultPlaywrightKeyboard.moves["operability:nextStop"], "Tab");
  assert.equal(defaultPlaywrightKeyboard.moves["operability:previousStop"], "Shift+Tab");
  assert.equal(await resolveKey(defaultPlaywrightKeyboard.moves["operability:nextItem"]!, roles("tab")), "ArrowRight");
  assert.equal(await resolveKey(defaultPlaywrightKeyboard.moves["operability:nextItem"]!, roles("option")), "ArrowDown");
  assert.equal(await resolveKey(defaultPlaywrightKeyboard.moves["operability:nextItem"]!, roles("gridcell")), undefined, "no key is guessed for an unlisted role");
  assert.equal(await resolveKey(defaultPlaywrightKeyboard.activation, roles("checkbox")), "Space");
  assert.equal(await resolveKey(defaultPlaywrightKeyboard.activation, roles("button")), "Space");
  assert.equal(await resolveKey(defaultPlaywrightKeyboard.activation, roles("link")), "Enter");
  assert.equal(await resolveKey(defaultPlaywrightKeyboard.activation, roles("option")), "Enter");
  assert.ok(Object.isFrozen(defaultPlaywrightKeyboard.moves["operability:nextItem"]));
  assert.strictEqual(parsePlaywrightKeyboard(undefined), defaultPlaywrightKeyboard);
});

test("mesh entries replace the default entry they name and keep the others", async () => {
  const keyboard = parsePlaywrightKeyboard({
    moves: { "operability:nextItem": { tab: "ArrowDown" }, "urn:producer:nextHeading": "h" },
    activation: "Enter"
  });
  assert.equal(await resolveKey(keyboard.moves["operability:nextItem"]!, roles("tab")), "ArrowDown");
  assert.equal(await resolveKey(keyboard.moves["operability:nextItem"]!, roles("option")), undefined);
  assert.equal(keyboard.moves["operability:nextStop"], "Tab");
  assert.equal(keyboard.moves["urn:producer:nextHeading"], "h");
  assert.equal(await resolveKey(keyboard.activation, roles("checkbox")), "Enter");
  assert.equal(await resolveKey(parsePlaywrightKeyboard({ activation: { "*": "Space", link: "Enter" } }).activation, roles("link")), "Enter");
});

test("malformed keyboard options fail at parse time", () => {
  assert.throws(() => parsePlaywrightKeyboard([]), /keyboard must be an object/);
  assert.throws(() => parsePlaywrightKeyboard({ keys: {} }), /Unknown option keyboard.keys/);
  assert.throws(() => parsePlaywrightKeyboard({ moves: { "operability:nextItem": "" } }), /nonempty Playwright key/);
  assert.throws(() => parsePlaywrightKeyboard({ moves: { "operability:nextItem": {} } }), /must name at least one role/);
  assert.throws(() => parsePlaywrightKeyboard({ activation: { pushbutton: "Enter" } }), /keyboard.activation.pushbutton is not an ARIA role Playwright supports/);
});
