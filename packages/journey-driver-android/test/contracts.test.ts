import assert from "node:assert/strict";
import test from "node:test";
import { androidApplicationEntryTarget, androidDeepLinkEntryTarget } from "../src/index.js";

test("Android entry targets are immutable values", () => {
  const application = androidApplicationEntryTarget();
  const link = androidDeepLinkEntryTarget("https://example.test/deep-link");
  assert.ok(Object.isFrozen(application));
  assert.ok(Object.isFrozen(link));
  assert.deepEqual(link, androidDeepLinkEntryTarget(link.url));
});
