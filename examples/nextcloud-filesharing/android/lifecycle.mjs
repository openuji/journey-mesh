#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { arch, homedir, platform } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const examplePath = "examples/nextcloud-filesharing";

export function selectSystemImage(runtime, hostPlatform = platform(), hostArch = arch()) {
  const key = `${hostPlatform}-${hostArch}`;
  const image = runtime.android.localImages?.[key];
  if (!image) throw new Error(`Unsupported Android emulator host ${key}; supported hosts: ${Object.keys(runtime.android.localImages ?? {}).join(", ")}`);
  return image;
}

export async function findSdk(environment = process.env) {
  const explicit = environment.ANDROID_HOME || environment.ANDROID_SDK_ROOT;
  const candidates = explicit ? [explicit] : [join(homedir(), "Library/Android/sdk"), join(homedir(), "Android/Sdk")];
  for (const candidate of candidates) {
    try { await readFile(resolve(candidate, "package.xml")); return resolve(candidate); }
    catch {
      if (existsSync(candidate)) return resolve(candidate);
    }
  }
  throw new Error(`Android SDK was not found${explicit ? ` at ${explicit}` : ""}; install Android Studio and set ANDROID_HOME`);
}

export function androidAvdHome(environment = process.env) {
  if (environment.ANDROID_AVD_HOME) return resolve(environment.ANDROID_AVD_HOME);
  if (environment.ANDROID_USER_HOME) return resolve(environment.ANDROID_USER_HOME, "avd");
  return resolve(homedir(), ".android/avd");
}

export async function findSdkTool(sdk, name) {
  const candidates = [resolve(sdk, "cmdline-tools/latest/bin", name), resolve(sdk, "tools/bin", name)];
  try {
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(resolve(sdk, "cmdline-tools")));
    entries.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    candidates.push(...entries.map((entry) => resolve(sdk, "cmdline-tools", entry, "bin", name)));
  } catch {}
  return candidates.find(existsSync);
}

function studioHomes(environment, hostPlatform) {
  const configured = environment.ANDROID_STUDIO_HOME ? [resolve(environment.ANDROID_STUDIO_HOME)] : [];
  if (hostPlatform === "darwin") configured.push("/Applications/Android Studio.app/Contents");
  if (hostPlatform === "linux") configured.push("/opt/android-studio", "/usr/local/android-studio");
  return configured;
}

async function commandOnPath(name, capture) {
  try { return (await capture("which", [name])).stdout.trim() || undefined; }
  catch { return undefined; }
}

export async function findAndroidCli(environment, hostPlatform, capture) {
  if (environment.ANDROID_CLI && existsSync(environment.ANDROID_CLI)) return resolve(environment.ANDROID_CLI);
  const found = await commandOnPath("android", capture);
  if (found) return found;
  for (const home of studioHomes(environment, hostPlatform)) {
    const candidate = resolve(home, "plugins/android/resources/android-cli/bin/android");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function javaHome(environment, hostPlatform) {
  if (environment.JAVA_HOME) return environment.JAVA_HOME;
  for (const home of studioHomes(environment, hostPlatform)) {
    const candidate = hostPlatform === "darwin" ? resolve(home, "jbr/Contents/Home") : resolve(home, "jbr");
    if (existsSync(resolve(candidate, "bin/java"))) return candidate;
  }
  return undefined;
}

function parseDevices(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^(\S+)\s+(device|offline|unauthorized)\b/.exec(line);
    return match ? [{ serial: match[1], state: match[2] }] : [];
  });
}

async function matchingDevices(adb, avd, capture) {
  const devices = parseDevices((await capture(adb, ["devices"])).stdout);
  const matches = [];
  for (const device of devices) {
    if (!device.serial.startsWith("emulator-") || device.state !== "device") continue;
    const result = await capture(adb, ["-s", device.serial, "emu", "avd", "name"], { optional: true });
    if (result.stdout.split(/\r?\n/)[0].trim() === avd) matches.push(device.serial);
  }
  return { devices, matches };
}

function parseIni(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const index = line.indexOf("=");
    return index > 0 ? [[line.slice(0, index), line.slice(index + 1)]] : [];
  }));
}

export async function validateAvd({ avd, avdHome, runtime, image }) {
  const configPath = resolve(avdHome, `${avd}.avd/config.ini`);
  const config = parseIni(await readFile(configPath, "utf8"));
  const [, expectedPlatform, expectedTarget, expectedAbi] = image.split(";");
  const mismatches = [];
  if (config.target !== expectedPlatform) mismatches.push(`target=${config.target || "missing"}`);
  if (config["tag.id"] !== expectedTarget) mismatches.push(`tag=${config["tag.id"] || "missing"}`);
  if (config["abi.type"] !== expectedAbi) mismatches.push(`abi=${config["abi.type"] || "missing"}`);
  if (config["hw.device.name"] !== runtime.android.profile) mismatches.push(`device=${config["hw.device.name"] || "missing"}`);
  if (mismatches.length) throw new Error(`AVD ${avd} is incompatible (${mismatches.join(", ")}); remove it explicitly or choose another name`);
}

async function portAvailable(port) {
  const server = createServer();
  return new Promise((done) => {
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });
}

async function emulatorPort() {
  for (let port = 5554; port <= 5584; port += 2) {
    if (await portAvailable(port) && await portAvailable(port + 1)) return port;
  }
  throw new Error("No free emulator port pair was found from 5554 through 5584");
}

async function writeEnvironment(path, values) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
  await rename(temporary, path);
}

function defaultCapture(environment, cwd) {
  return async (command, args, { optional = false, timeout = 30_000 } = {}) => {
    try { return await exec(command, args, { cwd, env: environment, timeout, maxBuffer: 4 * 1024 * 1024 }); }
    catch (error) {
      if (optional) return { stdout: "", stderr: String(error.stderr ?? ""), failed: true };
      throw new Error(`${command} failed${error.code === "ENOENT" ? " (command not found)" : ""}: ${String(error.stderr || error.message).trim()}`);
    }
  };
}

function defaultForeground(environment, cwd) {
  return (command, args, { input } = {}) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? done() : reject(new Error(`${command} exited with ${code ?? signal}`)));
    if (input !== undefined) child.stdin.end(input);
  });
}

async function provisionSdk({ sdk, image, environment, hostPlatform, capture, foreground }) {
  const packageDirectory = resolve(sdk, ...image.split(";"));
  let sdkmanager = await findSdkTool(sdk, "sdkmanager");
  let avdmanager = await findSdkTool(sdk, "avdmanager");
  const ready = existsSync(resolve(sdk, "emulator/emulator")) && existsSync(resolve(sdk, "platform-tools/adb")) && existsSync(packageDirectory) && avdmanager;
  if (!ready) {
    if (sdkmanager) {
      await foreground(sdkmanager, [`--sdk_root=${sdk}`, "platform-tools", "emulator", "cmdline-tools;latest", image]);
    } else {
      const android = await findAndroidCli(environment, hostPlatform, capture);
      if (!android) throw new Error("Android SDK command-line tools are missing and Android Studio's bundled android CLI was not found; set ANDROID_CLI or install a current Android Studio");
      await foreground(android, ["--no-metrics", `--sdk=${sdk}`, "sdk", "install", "platform-tools", "emulator", "cmdline-tools/latest", image.replaceAll(";", "/")]);
    }
    avdmanager = await findSdkTool(sdk, "avdmanager");
  }
  if (!existsSync(resolve(sdk, "emulator/emulator")) || !existsSync(resolve(sdk, "platform-tools/adb")) || !existsSync(packageDirectory) || !avdmanager) {
    throw new Error("Android SDK provisioning completed without the required emulator, platform tools, system image, and avdmanager");
  }
  return { avdmanager };
}

export async function androidUp({
  root = repository,
  environment = process.env,
  avd,
  hostPlatform = platform(),
  hostArch = arch(),
  capture: suppliedCapture,
  foreground: suppliedForeground,
  background,
  choosePort = emulatorPort,
  pause = delay,
  log = console.log,
  avdHome: suppliedAvdHome
} = {}) {
  if (!['darwin', 'linux'].includes(hostPlatform)) throw new Error("android:up supports macOS and Linux");
  const example = resolve(root, examplePath);
  const runtime = JSON.parse(await readFile(resolve(example, "android/runtime.json"), "utf8"));
  avd ||= environment.ANDROID_AVD_NAME || runtime.android.avd;
  const image = selectSystemImage(runtime, hostPlatform, hostArch);
  const sdk = await findSdk(environment);
  const env = { ...environment, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
  const discoveredJava = javaHome(env, hostPlatform);
  if (discoveredJava) { env.JAVA_HOME = discoveredJava; env.PATH = [resolve(discoveredJava, "bin"), env.PATH ?? ""].join(delimiter); }
  env.PATH = [resolve(sdk, "platform-tools"), resolve(sdk, "emulator"), env.PATH ?? ""].join(delimiter);
  const capture = suppliedCapture ?? defaultCapture(env, root);
  const foreground = suppliedForeground ?? defaultForeground(env, root);
  log(`[android:up] SDK: ${sdk}; image: ${image}; AVD: ${avd}`);
  await foreground(process.execPath, [resolve(example, "android/check-runtime.mjs")]);
  const { avdmanager } = await provisionSdk({ sdk, image, environment: env, hostPlatform, capture, foreground });
  const emulator = resolve(sdk, "emulator/emulator");
  const adb = resolve(sdk, "platform-tools/adb");
  const configured = (await capture(emulator, ["-list-avds"])).stdout.split(/\r?\n/).filter(Boolean);
  const avdHome = suppliedAvdHome ?? androidAvdHome(env);
  if (configured.includes(avd)) await validateAvd({ avd, avdHome, runtime, image });
  else {
    log(`[android:up] Create ${avd}`);
    await foreground(avdmanager, ["create", "avd", "--name", avd, "--package", image, "--device", runtime.android.profile], { input: "no\n" });
    await validateAvd({ avd, avdHome, runtime, image });
  }
  await foreground(process.execPath, [resolve(example, "android/download-apk.mjs")]);
  await capture(emulator, ["-accel-check"]);
  await capture(adb, ["start-server"]);
  const found = await matchingDevices(adb, avd, capture);
  let serial = environment.ANDROID_UDID && found.matches.includes(environment.ANDROID_UDID) ? environment.ANDROID_UDID : found.matches[0];
  let owned;
  let logPath;
  if (!serial) {
    const port = await choosePort();
    serial = `emulator-${port}`;
    const logDirectory = resolve(root, ".tmp/android-runtime");
    await mkdir(logDirectory, { recursive: true });
    logPath = resolve(logDirectory, `emulator-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    log(`[android:up] Boot ${avd} as ${serial}; log: ${logPath}`);
    if (background) owned = await background(emulator, ["-avd", avd, "-port", String(port), "-no-snapshot", "-no-boot-anim", "-no-window", "-no-audio", "-gpu", "swiftshader", "-feature", "-Vulkan"], { env, cwd: root, logPath });
    else {
      const output = openSync(logPath, "a", 0o600);
      const child = spawn(emulator, ["-avd", avd, "-port", String(port), "-no-snapshot", "-no-boot-anim", "-no-window", "-no-audio", "-gpu", "swiftshader", "-feature", "-Vulkan"], { cwd: root, env, detached: true, stdio: ["ignore", output, output] });
      closeSync(output);
      child.unref();
      owned = { pid: child.pid };
    }
  } else log(`[android:up] Reuse ${serial}`);
  try {
    let booted = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      const boot = await capture(adb, ["-s", serial, "shell", "getprop", "sys.boot_completed"], { optional: true, timeout: 5_000 });
      if (boot.stdout.trim() === "1") { booted = true; break; }
      await pause(2_000);
    }
    if (!booted) throw new Error(`Timed out waiting for ${serial} to boot${logPath ? `; see ${logPath}` : ""}`);
    const api = (await capture(adb, ["-s", serial, "shell", "getprop", "ro.build.version.sdk"])).stdout.trim();
    if (api !== String(runtime.android.api)) throw new Error(`AVD ${avd} booted API ${api}; expected ${runtime.android.api}`);
    const chrome = await capture(adb, ["-s", serial, "shell", "pm", "path", "com.android.chrome"]);
    if (!chrome.stdout.includes("package:")) throw new Error(`AVD ${avd} does not include Chrome`);
    await capture(adb, ["-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
    await capture(adb, ["-s", serial, "shell", "wm", "dismiss-keyguard"]);
    for (const setting of ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"]) {
      await capture(adb, ["-s", serial, "shell", "settings", "put", "global", setting, "0"]);
    }
    await writeEnvironment(resolve(example, ".runtime/android.env"), { ANDROID_UDID: serial });
    log(`[android:up] Ready: ${serial}`);
    return { serial, avd, image };
  } catch (error) {
    if (owned) {
      await capture(adb, ["-s", serial, "emu", "kill"], { optional: true, timeout: 10_000 });
      if (owned.pid) { try { process.kill(-owned.pid, "SIGTERM"); } catch {} }
    }
    throw error;
  }
}

export async function androidDown({ root = repository, environment = process.env, avd, capture: suppliedCapture, log = console.log } = {}) {
  const example = resolve(root, examplePath);
  const runtime = JSON.parse(await readFile(resolve(example, "android/runtime.json"), "utf8"));
  avd ||= environment.ANDROID_AVD_NAME || runtime.android.avd;
  const statePath = resolve(example, ".runtime/android.env");
  try {
    const sdk = await findSdk(environment);
    const env = { ...environment, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
    const capture = suppliedCapture ?? defaultCapture(env, root);
    const adb = resolve(sdk, "platform-tools/adb");
    if (existsSync(adb)) {
      const { matches } = await matchingDevices(adb, avd, capture);
      for (const serial of matches) {
        log(`[android:down] Stop ${avd} (${serial})`);
        await capture(adb, ["-s", serial, "emu", "kill"], { optional: true, timeout: 10_000 });
      }
      if (!matches.length) log(`[android:down] ${avd} is not running`);
    }
  } finally { await rm(statePath, { force: true }); }
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--avd") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --avd");
      options.avd = value;
    } else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown option ${argument}`);
  }
  return options;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const action = process.argv[2];
  const options = parseArguments(process.argv.slice(3));
  if (options.help || !["up", "down"].includes(action)) {
    console.log("Usage: node android/lifecycle.mjs <up|down> [--avd <name>]");
    if (!options.help && action) process.exitCode = 2;
  } else {
    await (action === "up" ? androidUp(options) : androidDown(options)).catch((error) => {
      console.error(`[android:${action}] ${error.message}`);
      process.exitCode = 1;
    });
  }
}
