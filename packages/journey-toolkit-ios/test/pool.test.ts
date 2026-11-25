import assert from "node:assert/strict";
import test from "node:test";
import { parseIosPool } from "../src/pool.js";

const pins = { deviceType: "iPhone 17", runtime: "26.2", locale: "en-US" };

test("parseIosPool parses single simulator and named multi-device pools", () => {
  const single = parseIosPool({ ...pins, simulator: "journey-mesh-ios" });
  assert.equal(single.environmentFile, true);
  assert.equal(single.targets.default?.simulator, "journey-mesh-ios");

  const multi = parseIosPool({
    ...pins,
    devices: { alice: { simulator: "alice-sim" }, bob: { simulator: "bob-sim" } }
  });
  assert.equal(multi.environmentFile, false);
  assert.deepEqual(Object.keys(multi.targets), ["alice", "bob"]);

  assert.throws(() => parseIosPool({ ...pins, simulator: "one", devices: { alice: { simulator: "two" } } }), /either simulator or devices/);
  assert.throws(() => parseIosPool({ ...pins, devices: {} }), /at least one device/);
  assert.throws(() => parseIosPool({ ...pins, devices: { Invalid: { simulator: "one" } } }), /lowercase letters/);
  assert.throws(() => parseIosPool({ ...pins, devices: { a: { simulator: "same" }, b: { simulator: "same" } } }), /more than one device/);
});
