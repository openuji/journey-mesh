import assert from "node:assert/strict";
import test from "node:test";
import { webEntryTarget } from "../src/index.js";

test("web entry targets are immutable values", () => {
  const first = webEntryTarget("https://example.test/files");
  const second = webEntryTarget("https://example.test/files");
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
});
