import assert from "node:assert/strict";
import test from "node:test";
import { parseAndroidPool } from "../src/pool.js";

const pins = {
  api: 35, image: "system-images;android-35;google_apis;x86_64",
  localImages: { "darwin-arm64": "system-images;android-35;google_apis;arm64-v8a" }, profile: "pixel_6"
};

test("a single avd stays the legacy default device that records android.env", () => {
  const pool = parseAndroidPool({ ...pins, avd: "journey-mesh-api35" });
  assert.deepEqual(Object.keys(pool.targets), ["default"]);
  assert.equal(pool.targets.default!.avd, "journey-mesh-api35");
  assert.equal(pool.environmentFile, true);
});

test("named devices share the pins and are reported only as outputs", () => {
  const pool = parseAndroidPool({ ...pins, devices: { alice: { avd: "journey-alice" }, bob: { avd: "journey-bob" } } });
  assert.deepEqual(Object.keys(pool.targets), ["alice", "bob"]);
  assert.equal(pool.targets.bob!.avd, "journey-bob");
  assert.equal(pool.targets.bob!.profile, "pixel_6");
  assert.equal(pool.environmentFile, false);
});

test("pool configuration rejects ambiguity", () => {
  assert.throws(() => parseAndroidPool({ ...pins, avd: "x", devices: { alice: { avd: "a" } } }), /either avd or devices/);
  assert.throws(() => parseAndroidPool({ ...pins, devices: {} }), /at least one device/);
  assert.throws(() => parseAndroidPool({ ...pins, devices: { alice: { avd: "same" }, bob: { avd: "same" } } }), /more than one device/);
  assert.throws(() => parseAndroidPool({ ...pins, devices: { Alice: { avd: "a" } } }), /lowercase/);
  assert.throws(() => parseAndroidPool({ ...pins, devices: { alice: { avd: "a", port: 5554 } } }), /Unknown option devices\.alice\.port/);
  assert.throws(() => parseAndroidPool({ ...pins, api: 34, devices: { alice: { avd: "a" } } }), /disagree/);
});
