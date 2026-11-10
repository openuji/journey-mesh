import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { appiumDown, appiumUp } from "../src/runtime/appium.js";

async function fixture(t: TestContext, { stale = false }: { stale?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "journey-appium-runtime-"));
  const example = join(root, "example");
  const sdk = join(root, "sdk");
  const events: { kind: string; args?: string[]; pid?: number; name?: string }[] = [];
  const live = new Set<number>();
  const put = async (path: string, value = ""): Promise<void> => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value); };
  await put(join(example, ".runtime/android.env"), "ANDROID_UDID=emulator-5554\n");
  await put(join(sdk, "platform-tools/adb"));
  if (stale) await put(join(example, ".runtime/appium.json"), JSON.stringify({ pid: 111, port: 4723, url: "http://127.0.0.1:4723/" }));
  const capture = async (_command: string, args: readonly string[]) => {
    events.push({ kind: "capture", args: [...args] });
    if (args.includes("get-state")) return { stdout: "device\n", stderr: "" };
    if (args.includes("list")) return { stdout: "{}", stderr: "" };
    if (args.includes("command=")) return { stdout: "node appium/index.js --port 4723\n", stderr: "" };
    return { stdout: "", stderr: "" };
  };
  const foreground = async (_command: string, args: readonly string[]) => { events.push({ kind: "foreground", args: [...args] }); };
  const background = async () => { live.add(222); events.push({ kind: "background" }); return { pid: 222 }; };
  const alive = (pid: number) => live.has(pid);
  const signal = (pid: number, name: string) => { events.push({ kind: "signal", pid, name }); live.delete(pid); };
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, example, sdk, events, live, capture, foreground, background, alive, signal };
}

test("Appium lifecycle installs its driver, publishes readiness, reuses, and stops its process", async (t) => {
  const setup = await fixture(t);
  const options = {
    root: setup.example, environment: { ANDROID_HOME: setup.sdk }, capture: setup.capture, foreground: setup.foreground,
    background: setup.background, alive: setup.alive, signal: setup.signal, ready: async () => true, isPortAvailable: async () => true, pause: async () => {}, log: () => {}
  };
  const state = await appiumUp(options);
  assert.equal(state.pid, 222);
  assert.ok(setup.events.some((event) => event.kind === "foreground" && event.args?.includes("install")));
  assert.equal((await readFile(join(setup.example, ".runtime/appium.env"), "utf8")).trim(), "APPIUM_URL=http://127.0.0.1:4723/");
  await appiumUp(options);
  assert.equal(setup.events.filter((event) => event.kind === "background").length, 1);
  await appiumDown({ root: setup.example, capture: setup.capture, alive: setup.alive, signal: setup.signal, pause: async () => {}, log: () => {} });
  assert.ok(setup.events.some((event) => event.kind === "signal" && event.pid === 222 && event.name === "SIGTERM"));
  await assert.rejects(readFile(join(setup.example, ".runtime/appium.env")), /ENOENT/);
});

test("Appium lifecycle replaces dead state and rejects an occupied port", async (t) => {
  const setup = await fixture(t, { stale: true });
  const base = {
    root: setup.example, environment: { ANDROID_HOME: setup.sdk }, capture: setup.capture, foreground: setup.foreground,
    background: setup.background, alive: setup.alive, ready: async () => true, pause: async () => {}, log: () => {}
  };
  await assert.rejects(appiumUp({ ...base, isPortAvailable: async () => false }), /already in use/);
  const state = await appiumUp({ ...base, isPortAvailable: async () => true });
  assert.equal(state.pid, 222);
});
