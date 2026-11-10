import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyPlan } from "@openuji/journey-runner";
import { ensureChromiumInstalled } from "../src/browser-binary.js";
import { playwrightAdapter } from "../src/index.js";

test("ensureChromiumInstalled resolves Chromium's CLI entry and is safe to call repeatedly", async () => {
  // This environment's Chromium build is already installed (the workspace's
  // own prerequisites step ensures it), so this exercises the cache-hit path
  // for real; a cache miss would run the identical `playwright install
  // chromium` command the former manual README step already documented.
  await assert.doesNotReject(ensureChromiumInstalled());
  await assert.doesNotReject(ensureChromiumInstalled());
});

test("the default browser path (no supplied browser/browserType) provisions Chromium and launches", async () => {
  // Every other test in this package supplies browser or browserType
  // directly, bypassing launchBrowser()/ensureChromiumInstalled() entirely —
  // this is the only coverage of the path real examples actually use.
  const driver = Object.freeze({
    name: "driver",
    resolveEntry: () => Object.freeze({ kind: "url" as const, url: "about:blank" }),
    resolveTransitionValue: () => undefined
  });
  const execution = playwrightAdapter({ driver }).createExecution({
    context: { runId: "run", executionId: "chromium-provisioning", profile: { id: "profile" }, plan: { id: "plan", operations: [] } as unknown as JourneyPlan }
  });
  await execution.start();
  await execution.close({ executionFailed: false });
});
