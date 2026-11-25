import assert from "node:assert/strict";
import test from "node:test";
import { iosUp, parseIosTarget, releaseIosDevice, validateIosTarget } from "../src/simctl.js";

const simctlJson = (state: "Shutdown" | "Booted" = "Shutdown", exists = true) => JSON.stringify({
  runtimes: [{ identifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-2", name: "iOS 26.2", version: "26.2", isAvailable: true }],
  devicetypes: [{ identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17", name: "iPhone 17" }],
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-26-2": exists ? [{
      udid: "SIM-UDID-1",
      name: "journey-mesh-ios",
      state,
      isAvailable: true,
      deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17"
    }] : []
  }
});

test("parseIosTarget and validateIosTarget reject invalid runtime or deviceType combinations", () => {
  const valid = parseIosTarget({ simulator: "journey-mesh-ios", deviceType: "iPhone 17", runtime: "26.2", locale: "en-US" });
  assert.doesNotThrow(() => validateIosTarget(valid));
  assert.throws(() => validateIosTarget({ ...valid, runtime: "com.apple.CoreSimulator.SimRuntime.watchOS-11-0" }), /Invalid iOS simulator runtime/);
  assert.throws(() => validateIosTarget({ ...valid, deviceType: "com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-10" }), /not an iPhone or iPad/);
});

test("iosUp creates or boots an owned simulator and shuts it down on release", async () => {
  const calls: string[][] = [];
  const target = parseIosTarget({ simulator: "journey-mesh-ios", deviceType: "iPhone 17", runtime: "26.2", locale: "en-US" });
  const capture = async (_cmd: string, args: readonly string[]) => {
    calls.push([...args]);
    if (args[1] === "list") return { stdout: simctlJson("Shutdown", false), stderr: "" };
    if (args[1] === "create") return { stdout: "CREATED-UDID\n", stderr: "" };
    return { stdout: "", stderr: "" };
  };
  const acquired = await iosUp({ target, hostPlatform: "darwin", capture, log: () => {} });
  assert.equal(acquired.udid, "CREATED-UDID");
  assert.equal(acquired.owned, true);
  assert.equal(acquired.platformVersion, "26.2");
  assert.ok(calls.some((args) => args[1] === "boot" && args[2] === "CREATED-UDID"));
  assert.ok(calls.some((args) => args[1] === "bootstatus" && args[2] === "CREATED-UDID"));

  await releaseIosDevice(acquired, { capture });
  assert.ok(calls.some((args) => args[1] === "shutdown" && args[2] === "CREATED-UDID"));
});

test("iosUp reuses a booted simulator as borrowed and releaseIosDevice preserves it", async () => {
  const calls: string[][] = [];
  const target = parseIosTarget({ simulator: "journey-mesh-ios", deviceType: "iPhone 17", runtime: "26.2" });
  const capture = async (_cmd: string, args: readonly string[]) => {
    calls.push([...args]);
    if (args[1] === "list") return { stdout: simctlJson("Booted", true), stderr: "" };
    return { stdout: "", stderr: "" };
  };
  const acquired = await iosUp({ target, hostPlatform: "darwin", capture, log: () => {} });
  assert.equal(acquired.owned, false);
  assert.equal(acquired.udid, "SIM-UDID-1");
  await releaseIosDevice(acquired, { capture });
  assert.equal(calls.some((args) => args[1] === "shutdown"), false);
});

test("iosUp rejects an existing simulator with mismatched deviceType", async () => {
  const target = parseIosTarget({ simulator: "journey-mesh-ios", deviceType: "iPhone 17", runtime: "26.2" });
  const mismatched = JSON.stringify({
    runtimes: [{ identifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-2", name: "iOS 26.2", version: "26.2", isAvailable: true }],
    devicetypes: [
      { identifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17", name: "iPhone 17" },
      { identifier: "com.apple.CoreSimulator.SimDeviceType.iPad-Pro", name: "iPad Pro" }
    ],
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [{
        udid: "SIM-UDID-1",
        name: "journey-mesh-ios",
        state: "Shutdown",
        isAvailable: true,
        deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPad-Pro"
      }]
    }
  });
  await assert.rejects(
    iosUp({ target, hostPlatform: "darwin", capture: async () => ({ stdout: mismatched, stderr: "" }), log: () => {} }),
    /Simulator journey-mesh-ios is incompatible/
  );
});
