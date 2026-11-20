import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  releaseAndroidDevice, androidUp, parseAndroidTarget, selectSystemImage, validateAndroidTarget, type AndroidRuntimeTarget
} from "../src/runtime/android.js";

const target: AndroidRuntimeTarget = {
  api: 35, avd: "journey-mesh-api35", image: "system-images;android-35;google_apis;x86_64",
  localImages: { "darwin-arm64": "system-images;android-35;google_apis;arm64-v8a", "linux-x64": "system-images;android-35;google_apis;x86_64" },
  profile: "pixel_6", locale: "en-US", requiredPackages: ["com.android.chrome"]
};

async function fixture(t: TestContext, { existing, incompatible = false }: { existing?: boolean; incompatible?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "journey-android-runtime-"));
  const example = join(root, "example");
  const sdk = join(root, "sdk");
  const avdHome = join(root, "avd");
  const events: { kind: string; command?: string; args: string[] }[] = [];
  const state = {
    configured: existing ? [target.avd] : ([] as string[]),
    devices: existing ? [{ serial: "emulator-5570", name: target.avd }] : ([] as { serial: string; name: string }[])
  };
  const put = async (path: string, value = ""): Promise<void> => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value); };
  for (const path of ["emulator/emulator", "platform-tools/adb", "cmdline-tools/latest/bin/avdmanager"]) await put(join(sdk, path));
  await mkdir(join(sdk, "system-images/android-35/google_apis/arm64-v8a"), { recursive: true });
  const writeAvd = async (bad = false) => put(join(avdHome, `${target.avd}.avd/config.ini`), [
    "target=android-35", "tag.id=google_apis", `abi.type=${bad ? "x86_64" : "arm64-v8a"}`, "hw.device.name=pixel_6", ""
  ].join("\n"));
  if (existing) await writeAvd(incompatible);
  const capture = async (command: string, args: readonly string[]) => {
    events.push({ kind: "capture", command, args: [...args] });
    if (command === "ps") return { stdout: `emulator -avd ${target.avd}`, stderr: "" };
    if (args.includes("-list-avds")) return { stdout: state.configured.join("\n") + "\n", stderr: "" };
    if (args[0] === "devices") return { stdout: "List of devices attached\n" + state.devices.map((item) => `${item.serial}\tdevice`).join("\n"), stderr: "" };
    if (args.includes("emu") && args.includes("name")) return { stdout: `${state.devices.find((item) => item.serial === args[1])?.name ?? ""}\nOK\n`, stderr: "" };
    if (args.includes("emu") && args.includes("kill")) { state.devices = state.devices.filter((item) => item.serial !== args[1]); return { stdout: "", stderr: "" }; }
    if (args.includes("sys.boot_completed")) return { stdout: "1\n", stderr: "" };
    if (args.includes("ro.build.version.sdk")) return { stdout: "35\n", stderr: "" };
    if (args.includes("com.android.chrome")) return { stdout: "package:/system/Chrome.apk\n", stderr: "" };
    return { stdout: "", stderr: "" };
  };
  const foreground = async (command: string, args: readonly string[]) => {
    events.push({ kind: "foreground", command, args: [...args] });
    if (args.includes("create") && args.includes("avd")) { state.configured.push(target.avd); await writeAvd(); }
  };
  const background = async (_command: string, args: readonly string[]) => {
    events.push({ kind: "background", args: [...args] });
    const serial = `emulator-${args[args.indexOf("-port") + 1]}`;
    state.devices.push({ serial, name: target.avd });
    return { pid: 4242 };
  };
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, example, sdk, avdHome, events, state, capture, foreground, background };
}

test("parseAndroidTarget validates required fields and types", () => {
  assert.deepEqual(parseAndroidTarget(target), target);
  assert.throws(() => parseAndroidTarget({ ...target, api: "35" }), /positive integer api/);
  assert.throws(() => parseAndroidTarget({ ...target, avd: "" }), /nonempty avd/);
  assert.throws(() => parseAndroidTarget({ ...target, requiredPackages: "com.android.chrome" }), /requiredPackages must be an array/);
});

test("validateAndroidTarget rejects a system image that disagrees with the pinned API level", () => {
  assert.doesNotThrow(() => validateAndroidTarget(target));
  assert.throws(() => validateAndroidTarget({ ...target, api: 34 }), /API level and system image disagree/);
  assert.throws(() => validateAndroidTarget({ ...target, localImages: { ...target.localImages, "linux-x64": "system-images;android-34;google_apis;x86_64" } }), /disagree/);
});

test("system image selection follows the host architecture", () => {
  assert.match(selectSystemImage(target, "darwin", "arm64"), /arm64-v8a$/);
  assert.match(selectSystemImage(target, "linux", "x64"), /x86_64$/);
  assert.throws(() => selectSystemImage(target, "linux", "arm64"), /Unsupported/);
});

test("android lifecycle creates, boots, reuses, and stops only its managed AVD", async (t) => {
  const setup = await fixture(t);
  const options = {
    root: setup.example, target, environment: { ANDROID_HOME: setup.sdk }, hostPlatform: "darwin", hostArch: "arm64", avdHome: setup.avdHome,
    capture: setup.capture, foreground: setup.foreground, background: setup.background, choosePort: async () => 5568, pause: async () => {}, log: () => {}
  };
  const first = await androidUp(options);
  assert.equal(first.serial, "emulator-5568");
  assert.ok(setup.events.some((event) => event.kind === "foreground" && event.args.includes("create")));
  await assert.rejects(readFile(join(setup.example, ".runtime/android.env")), /ENOENT/, "low-level acquisition does not publish environment files");
  const starts = setup.events.filter((event) => event.kind === "background").length;
  const borrowed = await androidUp(options);
  await releaseAndroidDevice(borrowed, { capture: setup.capture });
  assert.equal(setup.state.devices.length, 1, "borrowed emulators survive release");
  assert.equal(setup.events.filter((event) => event.kind === "background").length, starts);
  await releaseAndroidDevice(first, { capture: setup.capture, log: () => {}, stop: async (pid) => {
    assert.equal(pid, 4242);
    setup.state.devices = [];
  } });
  assert.equal(setup.state.devices.length, 0);
  await assert.rejects(readFile(join(setup.example, ".runtime/android.env")), /ENOENT/);
});

test("ADB discovery failure still stops the verified owned emulator and retains the error", async () => {
  const stopped: number[] = [];
  const device = { serial: "emulator-5556", avd: target.avd, image: target.image, sdk: "/sdk", pid: 4242, reversePorts: [] };
  const capture = async (command: string) => {
    if (command === "ps") return { stdout: `emulator -avd ${target.avd}`, stderr: "" };
    throw new Error("ADB is unavailable");
  };
  const stop = async (pid: number) => { stopped.push(pid); };
  await assert.rejects(releaseAndroidDevice(device, { capture, stop }), /ADB is unavailable/);
  assert.deepEqual(stopped, [4242]);
  await assert.rejects(releaseAndroidDevice({ ...device, pid: undefined }, { capture, stop }), /ADB is unavailable/);
  assert.deepEqual(stopped, [4242], "borrowed emulators are never stopped");
});

test("android lifecycle refuses an incompatible pre-existing AVD", async (t) => {
  const setup = await fixture(t, { existing: true, incompatible: true });
  await assert.rejects(androidUp({
    root: setup.example, target, environment: { ANDROID_HOME: setup.sdk }, hostPlatform: "darwin", hostArch: "arm64", avdHome: setup.avdHome,
    capture: setup.capture, foreground: setup.foreground, background: setup.background, pause: async () => {}, log: () => {}
  }), /incompatible.*abi=x86_64/);
  assert.ok(!setup.events.some((event) => event.kind === "background"));
});

test("reverse ports give the device localhost access to host services, on every boot or reuse", async (t) => {
  const setup = await fixture(t);
  const reversed = { ...target, reversePorts: [18446] };
  assert.deepEqual(parseAndroidTarget({ ...target, reversePorts: ["18446"] }).reversePorts, [18446]);
  assert.throws(() => parseAndroidTarget({ ...target, reversePorts: [70000] }), /TCP ports/);
  const options = {
    root: setup.example, target: reversed, environment: { ANDROID_HOME: setup.sdk }, hostPlatform: "darwin", hostArch: "arm64", avdHome: setup.avdHome,
    capture: setup.capture, foreground: setup.foreground, background: setup.background, choosePort: async () => 5568, pause: async () => {}, log: () => {},
    environmentFile: false
  };
  await androidUp(options);
  await androidUp(options);
  const reverses = setup.events.filter((event) => event.args.includes("reverse") && !event.args.includes("--list"));
  assert.equal(reverses.length, 2);
  assert.deepEqual(reverses[0]!.args, ["-s", "emulator-5568", "reverse", "tcp:18446", "tcp:18446"]);
  await assert.rejects(readFile(join(setup.example, ".runtime/android.env")), /ENOENT/);
});

test("borrowed device release preserves pre-existing reverse mappings and removes only acquired mappings", async (t) => {
  const setup = await fixture(t, { existing: true });
  const mappings = new Map([[18446, 18446]]);
  const capture = async (command: string, args: readonly string[]) => {
    if (args.includes("reverse")) {
      if (args.includes("--list")) return { stdout: [...mappings].map(([from, to]) => `emulator-5570 tcp:${from} tcp:${to}`).join("\n"), stderr: "" };
      const ports = args.filter((arg) => arg.startsWith("tcp:")).map((arg) => Number(arg.slice(4)));
      if (args.includes("--remove")) mappings.delete(ports[0]!); else mappings.set(ports[0]!, ports[1]!);
      return { stdout: "", stderr: "" };
    }
    return setup.capture(command, args);
  };
  const acquired = await androidUp({ root: setup.example, target: { ...target, reversePorts: [18446, 18447] }, environment: { ANDROID_HOME: setup.sdk }, hostPlatform: "darwin", hostArch: "arm64", avdHome: setup.avdHome,
    capture, foreground: setup.foreground, background: setup.background, pause: async () => {}, log: () => {} });
  assert.equal(acquired.pid, undefined);
  assert.deepEqual(acquired.reversePorts, [18447]);
  await releaseAndroidDevice(acquired, { capture });
  assert.deepEqual([...mappings], [[18446, 18446]]);
  assert.equal(setup.state.devices.length, 1);
});
