import assert from "node:assert/strict";
import test from "node:test";
import { iosApplicationEntryTarget, iosDeepLinkEntryTarget } from "../src/index.js";

test("iOS entry targets are immutable values", () => {
  const application = iosApplicationEntryTarget();
  const link = iosDeepLinkEntryTarget("nextcloud://open-file?url=test");
  assert.ok(Object.isFrozen(application));
  assert.ok(Object.isFrozen(link));
  assert.deepEqual(link, iosDeepLinkEntryTarget(link.url));
});
