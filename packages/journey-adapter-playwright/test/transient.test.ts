import assert from "node:assert/strict";
import test from "node:test";
import { noPlaywrightTransientUi, parsePlaywrightTransientUi } from "../src/index.js";

test("nothing is transient unless the suite declares it", () => {
  assert.strictEqual(parsePlaywrightTransientUi(undefined), noPlaywrightTransientUi);
  assert.deepEqual(noPlaywrightTransientUi, []);
  assert.ok(Object.isFrozen(noPlaywrightTransientUi));
});

test("entries name an ARIA role, optionally with its accessible name, or a CSS selector, and are frozen", () => {
  const parsed = parsePlaywrightTransientUi([{ role: "status" }, { role: "alert", name: "Saved" }, { css: ".toast" }]);
  assert.deepEqual(parsed, [{ role: "status" }, { role: "alert", name: "Saved" }, { css: ".toast" }]);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(parsed.every((entry) => Object.isFrozen(entry)));
});

test("malformed transientUi fails at parse time", () => {
  assert.throws(() => parsePlaywrightTransientUi({ role: "status" }), /transientUi must be a list/);
  assert.throws(() => parsePlaywrightTransientUi(["status"]), /transientUi\[0\] must be an object/);
  assert.throws(() => parsePlaywrightTransientUi([{ rol: "status" }]), /Unknown option transientUi\[0\].rol/);
  assert.throws(() => parsePlaywrightTransientUi([{}]), /transientUi\[0\] must name css or an ARIA role Playwright supports/);
  assert.throws(() => parsePlaywrightTransientUi([{ role: "toast" }]), /transientUi\[0\] must name css or an ARIA role Playwright supports/);
  assert.throws(() => parsePlaywrightTransientUi([{ css: "" }]), /transientUi\[0\].css must be a nonempty selector/);
  assert.throws(() => parsePlaywrightTransientUi([{ css: ".toast", role: "status" }]), /names either css or a role, not both/);
  assert.throws(() => parsePlaywrightTransientUi([{ role: "status", name: " " }]), /transientUi\[0\].name must be a nonempty accessible name/);
  assert.throws(() => parsePlaywrightTransientUi([{ role: "status" }, { css: 1 }]), /transientUi\[1\].css must be a nonempty selector/);
});
