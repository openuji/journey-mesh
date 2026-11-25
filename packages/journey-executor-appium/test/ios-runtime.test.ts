import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { appiumDown } from "../src/runtime/appium.js";
import { appiumIosUp } from "../src/runtime/appium-ios.js";

async function fixture(t: TestContext, { stale = false, booted = true }: { stale?: boolean; booted?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "journey-appium-ios-runtime-"));
  const example = join(root, "example");
  const statePath = join(example, ".runtime/appium-ios.json");
  const events: { kind: string; command?: string; args?: string[]; pid?: number; name?: string }[] = [];
  const live = new Set<number>();
  const put = async (path: string, value = ""): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, value);
  };
  await put(join(example, ".runtime/ios.env"), "IOS_UDID=SIM-UDID-1\n");
  if (stale) await put(statePath, JSON.stringify({ pid: 111, port: 4725, url: "http://127.0.0.1:4725/" }));
  const capture = async (command: string, args: readonly string[]) => {
    events.push({ kind: "capture", command, args: [...args] });
    if (command === "xcrun" && args[0] === "simctl") {
      return {
        stdout: JSON.stringify({
          devices: {
            "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [
              { udid: "SIM-UDID-1", state: booted ? "Booted" : "Shutdown" }
            ]
          }
        }),
        stderr: ""
      };
    }
    if (args.includes("list")) return { stdout: "{}", stderr: "" };
    if (args.includes("command=")) return { stdout: "node appium/index.js --port 4725\n", stderr: "" };
    return { stdout: "", stderr: "" };
  };
  const foreground = async (command: string, args: readonly string[]) => {
    events.push({ kind: "foreground", command, args: [...args] });
  };
  const background = async () => {
    live.add(222);
    events.push({ kind: "background" });
    return { pid: 222 };
  };
  const alive = (pid: number) => live.has(pid);
  const signal = (pid: number, name: string) => {
    events.push({ kind: "signal", pid, name });
    live.delete(pid);
  };
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, example, statePath, events, live, capture, foreground, background, alive, signal };
}

test("Appium iOS lifecycle verifies booted simulator without Android SDK, installs xcuitest, reuses, and stops", async (t) => {
  const setup = await fixture(t);
  const options = {
    devices: ["SIM-UDID-1"],
    root: setup.example,
    statePath: setup.statePath,
    environment: {},
    capture: setup.capture,
    foreground: setup.foreground,
    background: setup.background,
    alive: setup.alive,
    signal: setup.signal,
    ready: async () => true,
    isPortAvailable: async () => true,
    pause: async () => {},
    log: () => {}
  };
  const state = await appiumIosUp(options);
  assert.equal(state.pid, 222);
  assert.equal(state.port, 4725);
  assert.ok(
    setup.events.some(
      (event) =>
        event.kind === "foreground" &&
        event.args?.includes("install") &&
        event.args?.includes("--source=local") &&
        event.args.some((arg) => arg.includes("appium-xcuitest-driver"))
    )
  );
  await assert.rejects(readFile(join(setup.example, ".runtime/appium-ios.env")), /ENOENT/);
  const reused = await appiumIosUp(options);
  assert.equal(reused.owned, false);
  assert.equal(setup.events.filter((event) => event.kind === "background").length, 1);
  await appiumDown({
    root: setup.example,
    statePath: setup.statePath,
    capture: setup.capture,
    alive: setup.alive,
    signal: setup.signal,
    pause: async () => {},
    log: () => {}
  });
  assert.ok(setup.events.some((event) => event.kind === "signal" && event.pid === 222 && event.name === "SIGTERM"));
});

test("Appium iOS rejects unbooted simulator UDIDs and occupied ports", async (t) => {
  const unbooted = await fixture(t, { booted: false });
  await assert.rejects(
    appiumIosUp({
      devices: ["SIM-UDID-1"],
      root: unbooted.example,
      statePath: unbooted.statePath,
      environment: {},
      capture: unbooted.capture,
      foreground: unbooted.foreground,
      background: unbooted.background,
      alive: unbooted.alive,
      ready: async () => true,
      isPortAvailable: async () => true,
      pause: async () => {},
      log: () => {}
    }),
    /is not booted/
  );

  const stale = await fixture(t, { stale: true });
  await assert.rejects(
    appiumIosUp({
      devices: ["SIM-UDID-1"],
      root: stale.example,
      statePath: stale.statePath,
      environment: {},
      capture: stale.capture,
      foreground: stale.foreground,
      background: stale.background,
      alive: stale.alive,
      ready: async () => true,
      isPortAvailable: async () => false,
      pause: async () => {},
      log: () => {}
    }),
    /already in use/
  );
});
