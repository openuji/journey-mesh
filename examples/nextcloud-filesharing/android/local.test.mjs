import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { parseArguments, findSdk } from "./local.mjs";

const exec = promisify(execFile);
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const launcher = new URL("./local.mjs", import.meta.url).href;
const tools = String.raw`#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createServer } from "node:http";
const args = process.argv.slice(2);
const tool = process.argv[1].includes("/appium/") ? "appium" : basename(process.argv[1]);
const event = (name, extra = {}) => appendFileSync(process.env.LOCAL_EVENTS, JSON.stringify({ event: name, tool, args, pid: process.pid, ...extra }) + "\n");
const state = () => JSON.parse(readFileSync(process.env.LOCAL_STATE, "utf8"));
const save = (value) => writeFileSync(process.env.LOCAL_STATE, JSON.stringify(value));
event("command");
if (tool === "java") { console.error('openjdk version "21.0.5"'); process.exit(0); }
if (tool === "docker") {
  if (args.includes("ps")) console.log(process.env.LOCAL_RUNNING_SERVICES || "");
  process.exit(0);
}
if (tool === "emulator") {
  if (args.includes("-list-avds")) { console.log("journey-mesh-api35"); process.exit(0); }
  const serial = "emulator-" + args[args.indexOf("-port") + 1];
  const data = state(); data.devices.push({ serial, name: "journey-mesh-api35", pid: process.pid }); save(data);
  event("process-start", { serial });
  process.on("SIGTERM", () => { const data = state(); data.devices = data.devices.filter((device) => device.pid !== process.pid); save(data); event("process-stop"); process.exit(0); });
  setInterval(() => {}, 1000);
} else if (tool === "adb") {
  if (args[0] === "devices") { console.log("List of devices attached\n" + state().devices.map((device) => device.serial + "\tdevice").join("\n")); process.exit(0); }
  if (args.includes("logcat")) {
    event("process-start"); process.on("SIGTERM", () => { event("process-stop"); process.exit(0); }); setInterval(() => {}, 1000);
  } else {
    if (args.includes("emu") && args.includes("name")) console.log(state().devices.find((device) => device.serial === args[1])?.name + "\nOK");
    else if (args.includes("emu") && args.includes("kill")) { const device = state().devices.find((device) => device.serial === args[1]); if (device?.pid) { try { process.kill(device.pid, "SIGTERM"); } catch {} } }
    else if (args.includes("getprop")) console.log(args.includes("sys.boot_completed") ? "1" : "35");
    else if (args.includes("com.android.chrome")) console.log("package:/system/Chrome.apk");
    process.exit(0);
  }
} else if (tool === "appium") {
  if (args.includes("list")) { console.log(JSON.stringify({ uiautomator2: { version: "8.7.3" } })); process.exit(0); }
  const port = Number(args[args.indexOf("--port") + 1]);
  const server = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ value: { ready: true } })); });
  server.listen(port, "127.0.0.1", () => event("process-start"));
  process.on("SIGTERM", () => { event("process-stop"); server.close(() => process.exit(0)); });
} else if (tool === "pnpm") {
  if (process.env.LOCAL_FAIL_AT === "provision" && args.includes("stack:provision")) process.exit(7);
  if (args.includes("journey-mesh") && args.includes("test")) {
    event("journey-test");
    if (process.env.LOCAL_HANG_TEST === "1") {
      event("process-start"); process.on("SIGTERM", () => { event("process-stop"); process.exit(1); }); setInterval(() => {}, 1000);
    } else { console.log("PASS fixture journey test"); process.exit(process.env.LOCAL_FAIL_AT === "test" ? 9 : 0); }
  } else process.exit(0);
}
`;

async function fixture(t, extra = {}, devices = []) {
  const root = await mkdtemp(join(tmpdir(), "journey-android-local-"));
  const example = join(root, "examples/nextcloud-filesharing");
  const put = async (path, content) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); };
  const executable = async (path) => { await put(path, tools); await chmod(path, 0o755); };
  for (const name of ["pnpm", "docker"]) await executable(join(root, "bin", name));
  await executable(join(root, "jdk/bin/java"));
  await executable(join(root, "sdk/emulator/emulator"));
  await executable(join(root, "sdk/platform-tools/adb"));
  await executable(join(example, "node_modules/appium/index.js"));
  await put(join(example, "package.json"), JSON.stringify({ type: "module" }));
  await put(join(example, "node_modules/playwright/package.json"), JSON.stringify({ main: "index.cjs" }));
  await put(join(example, "node_modules/playwright/index.cjs"), 'exports.chromium = { executablePath: () => __filename };');
  await put(join(example, "node_modules/@openuji/journey-adapter-playwright/package.json"), JSON.stringify({ main: "index.cjs" }));
  await put(join(example, "node_modules/@openuji/journey-adapter-playwright/index.cjs"), "module.exports = {};");
  await put(join(example, "deployment/.env.example"), "NEXTCLOUD_ALICE_URL=http://host.docker.internal:18081\nNEXTCLOUD_BOB_URL=http://host.docker.internal:18082\n");
  for (const name of ["runtime.json", "configure-stack.mjs", "run-ci.sh"]) {
    const destination = join(example, "android", name); await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(repository, "examples/nextcloud-filesharing/android", name), destination);
  }
  await put(join(root, "state.json"), JSON.stringify({ devices }));
  await put(join(root, "events.jsonl"), "");
  await put(join(root, "proxy.mjs"), `import { launchLocalAndroid } from ${JSON.stringify(launcher)};
try { await launchLocalAndroid({ root: ${JSON.stringify(root)}, test: process.env.LOCAL_ALL === "1" ? "" : "native-recipient-sharing" }); }
catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
`);
  const env = { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH,
    ANDROID_HOME: join(root, "sdk"), JAVA_HOME: join(root, "jdk"), NEXTCLOUD_ANDROID_HOST: "127.0.0.1",
    LOCAL_STATE: join(root, "state.json"), LOCAL_EVENTS: join(root, "events.jsonl"), ...extra };
  for (const key of ["APPIUM_HOME", "APPIUM_URL", "APPIUM_PORT", "ANDROID_UDID", "ANDROID_SDK_ROOT", "NEXTCLOUD_STACK_ENV_FILE", "NEXTCLOUD_ANDROID_APK"]) delete env[key];
  const events = async () => (await readFile(env.LOCAL_EVENTS, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  t.after(async () => {
    const entries = await events(); const active = new Set();
    for (const entry of entries) { if (entry.event === "process-start") active.add(entry.pid); if (entry.event === "process-stop") active.delete(entry.pid); }
    for (const pid of active) { try { process.kill(pid, "SIGKILL"); } catch {} }
    await rm(root, { recursive: true, force: true });
  });
  return { root, env, events, run: () => exec(process.execPath, [join(root, "proxy.mjs")], { env, timeout: 20_000 }) };
}

test("local Android arguments retain one-command defaults and allow ordinary YAML selection", () => {
  assert.deepEqual(parseArguments([], {}), { avd: "journey-mesh-api35", test: "native-recipient-sharing" });
  assert.equal(parseArguments(["--all"], {}).test, "");
  assert.equal(parseArguments(["--avd", "dedicated", "--test", "sharing"], {}).avd, "dedicated");
  assert.throws(() => parseArguments(["--all", "--test", "sharing"], {}), /either/);
  assert.throws(() => parseArguments(["--avd"], {}), /Missing value/);
});

test("SDK discovery rejects an explicit invalid SDK instead of silently using another installation", async () => {
  await assert.rejects(findSdk({ ANDROID_HOME: "/nonexistent-journey-sdk" }), /SDK tools were not found/);
});

test("local launcher boots the AVD, runs the actual CI helper, and stops only newly started services", async (t) => {
  const setup = await fixture(t, { LOCAL_RUNNING_SERVICES: "alice" });
  const output = await setup.run(); assert.match(output.stdout, /Passed\. Report:/);
  const entries = await setup.events();
  const boot = entries.find((entry) => entry.tool === "emulator" && entry.args.includes("-avd"));
  assert.ok(boot);
  assert.equal(boot.args[boot.args.indexOf("-gpu") + 1], "swiftshader");
  assert.equal(boot.args[boot.args.indexOf("-feature") + 1], "-Vulkan");
  assert.ok(entries.some((entry) => entry.tool === "appium" && entry.args.includes("--port")));
  const stop = entries.find((entry) => entry.tool === "docker" && entry.args.includes("stop"));
  assert.deepEqual(stop.args.slice(stop.args.indexOf("stop") + 1), ["postgres", "bob"]);
  assert.ok(entries.some((entry) => entry.tool === "adb" && entry.args.includes("kill")));
  assert.equal(JSON.parse(await readFile(setup.env.LOCAL_STATE, "utf8")).devices.length, 0);
  const started = entries.filter((entry) => entry.event === "process-start").map((entry) => entry.pid);
  assert.ok(started.every((pid) => entries.some((entry) => entry.pid === pid && entry.event === "process-stop")));
});

test("local launcher reuses the named AVD and existing services and forwards all-test selection", async (t) => {
  const setup = await fixture(t, { LOCAL_RUNNING_SERVICES: "postgres\nalice\nbob", LOCAL_ALL: "1" }, [{ serial: "emulator-5584", name: "journey-mesh-api35" }]);
  await setup.run();
  const entries = await setup.events();
  assert.ok(!entries.some((entry) => entry.tool === "emulator" && entry.args.includes("-avd")));
  assert.ok(!entries.some((entry) => entry.tool === "adb" && entry.args.includes("kill")));
  assert.ok(!entries.some((entry) => entry.tool === "docker" && entry.args.includes("stop")));
  assert.ok(!entries.find((entry) => entry.event === "journey-test").args.includes("--test"));
});

test("provisioning failure still closes the owned emulator and partially started stack", async (t) => {
  const setup = await fixture(t, { LOCAL_FAIL_AT: "provision" });
  await assert.rejects(setup.run(), /Provision Nextcloud services failed/);
  const entries = await setup.events();
  assert.ok(entries.some((entry) => entry.tool === "adb" && entry.args.includes("kill")));
  assert.ok(entries.some((entry) => entry.tool === "docker" && entry.args.includes("stop")));
  assert.ok(!entries.some((entry) => entry.event === "journey-test"));
});

test("journey failure preserves a failing exit status and cleans up Appium and the emulator", async (t) => {
  const setup = await fixture(t, { LOCAL_FAIL_AT: "test" });
  await assert.rejects(setup.run(), /Run YAML journey tests failed/);
  const entries = await setup.events();
  const appium = entries.find((entry) => entry.tool === "appium" && entry.event === "process-start");
  assert.ok(entries.some((entry) => entry.pid === appium.pid && entry.event === "process-stop"));
  assert.ok(entries.some((entry) => entry.tool === "adb" && entry.args.includes("kill")));
});

test("interruption terminates the helper process group and cleans owned resources", async (t) => {
  const setup = await fixture(t, { LOCAL_HANG_TEST: "1" });
  const child = spawn(process.execPath, [join(setup.root, "proxy.mjs")], { env: setup.env, stdio: ["ignore", "pipe", "pipe"] });
  const completed = new Promise((done) => child.once("exit", (code) => done(code)));
  t.after(() => child.kill("SIGKILL"));
  let ready = false;
  for (let attempt = 0; attempt < 500; attempt++) {
    if ((await setup.events()).some((entry) => entry.event === "journey-test")) { ready = true; break; }
    await delay(20);
  }
  assert.equal(ready, true);
  child.kill("SIGTERM"); assert.equal(await completed, 143);
  const entries = await setup.events();
  assert.ok(entries.some((entry) => entry.tool === "adb" && entry.args.includes("kill")));
  assert.ok(entries.some((entry) => entry.tool === "docker" && entry.args.includes("stop")));
});
