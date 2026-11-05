#!/usr/bin/env node
import { spawn, execFile } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer, isIPv4 } from "node:net";
import { homedir, networkInterfaces, platform } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const example = "examples/nextcloud-filesharing";
const packageName = "@openuji/example-nextcloud-filesharing";
const usage = `Usage (from examples/nextcloud-filesharing):
  pnpm android:local [--avd <name>] [--test <id> | --all]

Boots journey-mesh-api35, prepares the pinned tooling and Nextcloud stack,
starts Appium, and runs native-recipient-sharing from journey.yaml.
SDK paths are discovered automatically or read from ANDROID_HOME/ANDROID_SDK_ROOT.
Only processes and example services started by this launcher are stopped on exit.
Logs and service volumes are retained. Docker, JDK 21, and an existing AVD are required.`;

export function parseArguments(args, environment = process.env) {
  const options = { avd: environment.ANDROID_AVD_NAME || "journey-mesh-api35", test: "native-recipient-sharing" };
  let selected = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") return { ...options, help: true };
    if (argument === "--all") {
      if (selected) throw new Error("Choose either --test or --all");
      selected = true; options.test = ""; continue;
    }
    if (argument !== "--avd" && argument !== "--test") throw new Error(`Unknown option ${argument}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    if (argument === "--test") {
      if (selected) throw new Error("Choose either --test or --all");
      selected = true; options.test = value;
    } else options.avd = value;
  }
  return options;
}

/** The explicit root/environment also permit lifecycle tests against isolated tool fixtures. */
export async function launchLocalAndroid({ root = repository, environment = process.env, avd = "journey-mesh-api35", test = "native-recipient-sharing", log = console.log } = {}) {
  if (!["darwin", "linux"].includes(platform())) throw new Error("Use macOS or Linux (with an Android SDK and Docker).");
  const env = { ...environment };
  const logDir = resolve(root, ".tmp/android-local", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(logDir, { recursive: true });
  const controller = new AbortController();
  let activeJob;
  let ownedEmulator;
  let serial;
  let composeArgs;
  let startedServices = [];
  let stackRequested = false;
  let interrupted;
  let counter = 0;
  const stage = (message) => log(`[android:local] ${message}`);
  const capture = async (command, args, { timeout = 15_000, optional = false, cleanup = false } = {}) => {
    try {
      return await exec(command, args, { cwd: root, env, timeout, maxBuffer: 2 * 1024 * 1024,
        ...(cleanup ? {} : { signal: controller.signal }) });
    } catch (error) {
      if (optional && !controller.signal.aborted) return { stdout: "", stderr: String(error.stderr ?? ""), failed: true };
      if (controller.signal.aborted && !cleanup) throw controller.signal.reason;
      throw new Error(`${command} failed${error.code === "ENOENT" ? " (command not found)" : ""}: ${String(error.stderr || error.message).trim()}`);
    }
  };
  const start = (command, args, name, live = false) => {
    const path = join(logDir, `${++counter}-${name}.log`);
    const output = createWriteStream(path, { mode: 0o600 });
    const child = spawn(command, args, { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const task = { child, path, result: undefined, stopping: undefined };
    task.finished = new Promise((done) => {
      child.once("error", (error) => { task.result = { code: null, error }; });
      child.stdout.on("data", (chunk) => { output.write(chunk); if (live) process.stdout.write(chunk); });
      child.stderr.on("data", (chunk) => { output.write(chunk); if (live) process.stderr.write(chunk); });
      child.once("close", (code, signal) => {
        task.result ??= { code, signal };
        output.end(() => done(task.result));
      });
    });
    return task;
  };
  const stop = (task, graceMs = 10_000) => {
    if (!task || task.result) return Promise.resolve();
    if (task.child.exitCode !== null || task.child.signalCode) return task.finished;
    return task.stopping ??= (async () => {
      const signal = async (name) => {
        try { if (task.child.pid) process.kill(-task.child.pid, name); }
        catch (error) {
          if (error.code === "ESRCH") return;
          // Darwin can report EPERM for a process group that just became empty.
          // Let Node reap our child before treating that race as a cleanup failure.
          if (error.code === "EPERM") {
            await Promise.race([task.finished, delay(200)]);
            if (task.result) return;
          }
          throw error;
        }
      };
      await signal("SIGTERM");
      let timer;
      await Promise.race([task.finished, new Promise((done) => { timer = setTimeout(done, graceMs); })]);
      clearTimeout(timer);
      if (!task.result) { await signal("SIGKILL"); await task.finished; }
    })();
  };
  const run = async (message, command, args, { timeout = 600_000, live = false } = {}) => {
    controller.signal.throwIfAborted();
    stage(message);
    const task = start(command, args, message.toLowerCase().replace(/[^a-z0-9]+/g, "-"), live);
    activeJob = task;
    let expired = false;
    const timer = setTimeout(() => { expired = true; void stop(task); }, timeout);
    try {
      const result = await task.finished;
      controller.signal.throwIfAborted();
      if (expired || result.code !== 0) throw new Error(`${message} ${expired ? "timed out" : "failed"}. See ${task.path}`);
    } finally { clearTimeout(timer); activeJob = undefined; }
  };
  const onSignal = (signal) => {
    interrupted = signal === "SIGINT" ? 130 : 143;
    controller.abort(new Error("Local Android run interrupted"));
    void stop(activeJob, 30_000).catch(() => {});
  };
  const onInt = () => onSignal("SIGINT");
  const onTerm = () => onSignal("SIGTERM");
  process.on("SIGINT", onInt); process.on("SIGTERM", onTerm);
  let failure;
  stage(`Logs: ${logDir}`);
  try {
    const sdk = await findSdk(env);
    env.ANDROID_HOME = sdk;
    env.ANDROID_SDK_ROOT = sdk;
    env.PATH = [join(sdk, "platform-tools"), join(sdk, "emulator"), env.PATH ?? ""].join(delimiter);
    if (!env.JAVA_HOME && platform() === "darwin") {
      const java = await capture("/usr/libexec/java_home", ["-v", "21"], { optional: true });
      if (!java.failed) env.JAVA_HOME = java.stdout.trim();
    }
    if (env.JAVA_HOME) env.PATH = [join(env.JAVA_HOME, "bin"), env.PATH].join(delimiter);
    const java = await capture("java", ["-version"]);
    if (!/version "21(?:\.|\")/.test(java.stderr + java.stdout)) throw new Error("JDK 21 is required; set JAVA_HOME to its installation.");
    stage(`SDK: ${sdk}; AVD: ${avd}`);
    const adb = join(sdk, "platform-tools/adb");
    const emulator = join(sdk, "emulator/emulator");
    const available = (await capture(emulator, ["-list-avds"])).stdout.trim().split(/\r?\n/);
    if (!available.includes(avd)) throw new Error(`AVD ${avd} was not found. Available AVDs: ${available.join(", ") || "none"}. Use --avd to select an existing test AVD.`);
    const projectRequire = createRequire(resolve(root, example, "package.json"));
    let dependenciesReady = existsSync(resolve(root, example, "node_modules/appium/index.js"));
    try {
      projectRequire.resolve("@openuji/journey-cli");
      createRequire(projectRequire.resolve("@openuji/journey-adapter-playwright")).resolve("playwright");
    } catch { dependenciesReady = false; }
    if (!dependenciesReady) await run("Install workspace dependencies", "pnpm", ["install", "--frozen-lockfile"]);
    await run("Build workspace", "pnpm", ["build"]);
    await run("Check Android runtime pins", "pnpm", ["--filter", packageName, "android:check"]);
    const runtime = JSON.parse(await readFile(resolve(root, example, "android/runtime.json"), "utf8"));
    env.APPIUM_HOME ||= resolve(root, `.tmp/appium-local-${runtime.automation.appium}-${runtime.automation.uiautomator2}`);
    await mkdir(env.APPIUM_HOME, { recursive: true });
    const appium = resolve(root, example, "node_modules/appium/index.js");
    const installed = JSON.parse((await capture(process.execPath, [appium, "driver", "list", "--installed", "--json"], { timeout: 60_000 })).stdout);
    const driver = installed.uiautomator2;
    if (driver && driver.version !== runtime.automation.uiautomator2) throw new Error(`APPIUM_HOME contains UiAutomator2 ${driver.version}; expected ${runtime.automation.uiautomator2}. Unset APPIUM_HOME to use this launcher's isolated installation.`);
    if (!driver) await run("Install pinned UiAutomator2 driver", process.execPath, [appium, "driver", "install", "--source=local", resolve(root, example, "node_modules/appium-uiautomator2-driver")]);
    if (!env.NEXTCLOUD_ANDROID_APK) await run("Prepare pinned Nextcloud APK", "pnpm", ["--filter", packageName, "android:apk"]);
    const require = createRequire(resolve(root, example, "package.json"));
    const browserRequire = createRequire(require.resolve("@openuji/journey-adapter-playwright"));
    if (!existsSync(browserRequire("playwright").chromium.executablePath())) await run("Install Chromium", process.execPath, [browserRequire.resolve("playwright/cli"), "install", "chromium"]);

    let docker = await capture("docker", ["info"], { optional: true, timeout: 15_000 });
    if (docker.failed && platform() === "darwin") {
      stage("Start Docker Desktop");
      await capture("open", ["-a", "Docker"]);
      const dockerDeadline = Date.now() + 120_000;
      while (docker.failed && Date.now() < dockerDeadline) {
        await delay(2_000, undefined, { signal: controller.signal });
        docker = await capture("docker", ["info"], { optional: true, timeout: 5_000 });
      }
    }
    if (docker.failed) throw new Error("Docker is unavailable. Install/start Docker and ensure this user can access its daemon.");
    await capture(adb, ["start-server"]);
    const devices = parseDevices((await capture(adb, ["devices"])).stdout);
    const matches = [];
    for (const device of devices) {
      if (!device.serial.startsWith("emulator-") || device.state !== "device") continue;
      const name = (await capture(adb, ["-s", device.serial, "emu", "avd", "name"], { optional: true })).stdout.split(/\r?\n/)[0].trim();
      if (name === avd) matches.push(device.serial);
    }
    if (env.ANDROID_UDID && devices.some((device) => device.serial === env.ANDROID_UDID) && !matches.includes(env.ANDROID_UDID)) {
      throw new Error(`ANDROID_UDID ${env.ANDROID_UDID} is not the requested AVD ${avd}; refusing to reset a different device.`);
    }
    if (env.ANDROID_UDID && matches.length && !matches.includes(env.ANDROID_UDID)) throw new Error(`AVD ${avd} is already running as ${matches[0]}; unset ANDROID_UDID or use that serial.`);
    serial = env.ANDROID_UDID || matches[0];
    if (!matches.includes(serial)) {
      const requested = serial ? /^emulator-(\d+)$/.exec(serial) : undefined;
      if (serial && !requested) throw new Error("The local launcher requires an emulator serial such as emulator-5554.");
      const port = await emulatorPort(requested ? Number(requested[1]) : undefined);
      serial = `emulator-${port}`;
      stage(`Boot ${avd} (${serial})`);
      // Chrome process cleanup can crash gfxstream with the deprecated indirect
      // renderer. Use the supported software renderer without guest Vulkan.
      ownedEmulator = start(emulator, ["-avd", avd, "-port", String(port), "-no-snapshot", "-no-boot-anim", "-no-window", "-no-audio", "-gpu", "swiftshader", "-feature", "-Vulkan"], "emulator");
    } else stage(`Reuse running ${avd} (${serial})`);
    env.ANDROID_UDID = serial;
    let booted = false;
    const bootDeadline = Date.now() + 300_000;
    while (Date.now() < bootDeadline) {
      controller.signal.throwIfAborted();
      if (ownedEmulator?.result) throw new Error(`Emulator exited before boot. See ${ownedEmulator.path}`);
      const boot = await capture(adb, ["-s", serial, "shell", "getprop", "sys.boot_completed"], { optional: true, timeout: 5_000 });
      if (boot.stdout.trim() === "1") { booted = true; break; }
      await delay(2_000, undefined, { signal: controller.signal });
    }
    if (!booted) throw new Error(`Timed out waiting for ${serial} to boot. See ${logDir}`);
    if (!(await capture(adb, ["-s", serial, "shell", "pm", "path", "com.android.chrome"])).stdout.includes("package:")) throw new Error(`AVD ${avd} needs Chrome for the Nextcloud login flow. Select a Google APIs image that includes it.`);
    await capture(adb, ["-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
    await capture(adb, ["-s", serial, "shell", "wm", "dismiss-keyguard"]);
    for (const setting of ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"]) await capture(adb, ["-s", serial, "shell", "settings", "put", "global", setting, "0"]);
    const api = (await capture(adb, ["-s", serial, "shell", "getprop", "ro.build.version.sdk"])).stdout.trim();
    stage(`Android ready: ${serial}, API ${api}`);

    if (env.NEXTCLOUD_STACK_ENV_FILE) {
      env.NEXTCLOUD_STACK_ENV_FILE = resolve(root, env.NEXTCLOUD_STACK_ENV_FILE);
      await access(env.NEXTCLOUD_STACK_ENV_FILE);
    } else {
      const host = env.NEXTCLOUD_ANDROID_HOST || await discoverHost(capture);
      if (!isIPv4(host)) throw new Error("Could not find a reachable host IPv4 address. Set NEXTCLOUD_ANDROID_HOST to this machine's LAN IPv4 address.");
      env.NEXTCLOUD_STACK_ENV_FILE = (await capture(process.execPath, [resolve(root, example, "android/configure-stack.mjs"), host])).stdout.trim();
    }
    const port = await freePort(4723);
    env.APPIUM_PORT = String(port);
    env.APPIUM_URL = `http://127.0.0.1:${port}/`;
    env.ANDROID_LOG_DIR = logDir;
    env.JOURNEY_MESH_TEST = test;
    const testArgs = ["--filter", packageName, "exec", "journey-mesh", "validate", "journey.yaml", ...(test ? ["--test", test] : [])];
    await run("Validate selected YAML tests", "pnpm", testArgs);
    composeArgs = ["compose", "--env-file", env.NEXTCLOUD_STACK_ENV_FILE, "-f", resolve(root, example, "deployment/compose.yaml")];
    const running = (await capture("docker", [...composeArgs, "ps", "--services", "--status", "running"])).stdout.split(/\s+/);
    startedServices = ["postgres", "alice", "bob"].filter((name) => !running.includes(name));
    stackRequested = true;
    for (const [message, script] of [["Start Nextcloud services", "stack:up"], ["Provision Nextcloud services", "stack:provision"], ["Seed Nextcloud fixtures", "stack:seed"]]) await run(message, "pnpm", ["--filter", packageName, script]);
    stage(`Appium: ${env.APPIUM_URL}; test: ${test || "all YAML tests"}`);
    await run("Run YAML journey tests", "bash", [resolve(root, example, "android/run-ci.sh")], { timeout: 30 * 60_000, live: true });
    stage(`Passed. Report: ${resolve(root, example, "test-results/index.html")}`);
  } catch (error) { failure = error; }
  finally {
    stage("Clean up owned runtime processes");
    const errors = [];
    try { await stop(activeJob); } catch (error) { errors.push(error); }
    if (ownedEmulator && !ownedEmulator.result) {
      try { await capture(join(env.ANDROID_HOME, "platform-tools/adb"), ["-s", serial, "emu", "kill"], { cleanup: true, timeout: 10_000 }); } catch {}
      // Let the emulator finish its normal shutdown before falling back to signals.
      // Killing QEMU immediately after `emu kill` can trigger a crash dialog next boot.
      let shutdownTimer;
      await Promise.race([ownedEmulator.finished, new Promise((done) => { shutdownTimer = setTimeout(done, 10_000); })]);
      clearTimeout(shutdownTimer);
      try { await stop(ownedEmulator); } catch (error) { errors.push(error); }
    }
    if (stackRequested && startedServices.length) {
      try {
        const output = await capture("docker", [...composeArgs, "stop", ...startedServices], { cleanup: true, timeout: 60_000 });
        await writeFile(join(logDir, "cleanup-services.log"), output.stdout + output.stderr, { mode: 0o600 });
      } catch (error) { errors.push(error); }
    }
    process.removeListener("SIGINT", onInt); process.removeListener("SIGTERM", onTerm);
    stage(`Logs: ${logDir}`);
    if (errors.length) failure = new AggregateError([...(failure ? [failure] : []), ...errors], [...(failure ? [failure.message] : []), ...errors.map((error) => error.message)].join("; "));
  }
  if (interrupted && !failure) failure = controller.signal.reason;
  if (failure) { if (interrupted) failure.exitCode = interrupted; throw failure; }
}

export async function findSdk(env) {
  const explicit = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  const candidates = explicit ? [explicit] : [join(homedir(), "Library/Android/sdk"), join(homedir(), "Android/Sdk")];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "emulator/emulator")) && existsSync(join(candidate, "platform-tools/adb"))) return resolve(candidate);
  }
  throw new Error(`Android SDK tools were not found${explicit ? ` in ${explicit}` : ""}. Set ANDROID_HOME to the SDK containing emulator/ and platform-tools/.`);
}
function parseDevices(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^(\S+)\s+(device|offline|unauthorized)\b/.exec(line);
    return match ? [{ serial: match[1], state: match[2] }] : [];
  });
}
async function portAvailable(port) {
  const server = createServer();
  return new Promise((done) => {
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });
}
async function freePort(preferred) {
  if (await portAvailable(preferred)) return preferred;
  const server = createServer();
  return new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => done(port)); });
  });
}
async function emulatorPort(requested) {
  const ports = requested === undefined ? Array.from({ length: 16 }, (_, index) => 5554 + index * 2) : [requested];
  for (const port of ports) {
    if (port >= 5554 && port <= 5584 && port % 2 === 0 && await portAvailable(port) && await portAvailable(port + 1)) return port;
  }
  throw new Error("No free emulator port pair was found (use an even port from 5554 to 5584).");
}
async function discoverHost(capture) {
  if (platform() === "linux") return (await capture("docker", ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"])).stdout.trim();
  const route = await capture("/sbin/route", ["-n", "get", "default"], { optional: true });
  const preferred = /interface:\s*(\S+)/.exec(route.stdout)?.[1];
  const interfaces = networkInterfaces();
  for (const name of [preferred, "en0", "en1", ...Object.keys(interfaces)].filter(Boolean)) {
    const address = interfaces[name]?.find((item) => item.family === "IPv4" && !item.internal && !item.address.startsWith("169.254."));
    if (address) return address.address;
  }
  return "";
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let options;
  try { options = parseArguments(process.argv.slice(2)); }
  catch (error) { console.error(error.message); console.error(usage); process.exitCode = 2; }
  if (options?.help) console.log(usage);
  else if (options) await launchLocalAndroid(options).catch((error) => { console.error(`[android:local] ${error.message}`); process.exitCode = error.exitCode || 1; });
}
