import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  androidDown, androidUp, parseAndroidTarget, selectSystemImage, validateAndroidTarget, type AndroidRuntimeTarget
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
  assert.equal((await readFile(join(setup.example, ".runtime/android.env"), "utf8")).trim(), "ANDROID_UDID=emulator-5568");
  const starts = setup.events.filter((event) => event.kind === "background").length;
  await androidUp(options);
  assert.equal(setup.events.filter((event) => event.kind === "background").length, starts);
  await androidDown({ root: setup.example, avd: target.avd, environment: { ANDROID_HOME: setup.sdk }, capture: setup.capture, log: () => {} });
  assert.equal(setup.state.devices.length, 0);
  await assert.rejects(readFile(join(setup.example, ".runtime/android.env")), /ENOENT/);
});

test("android lifecycle refuses an incompatible pre-existing AVD", async (t) => {
  const setup = await fixture(t, { existing: true, incompatible: true });
  await assert.rejects(androidUp({
    root: setup.example, target, environment: { ANDROID_HOME: setup.sdk }, hostPlatform: "darwin", hostArch: "arm64", avdHome: setup.avdHome,
    capture: setup.capture, foreground: setup.foreground, background: setup.background, pause: async () => {}, log: () => {}
  }), /incompatible.*abi=x86_64/);
  assert.ok(!setup.events.some((event) => event.kind === "background"));
});
