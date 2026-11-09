#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { findSdk } from "./lifecycle.mjs";

const exec = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const examplePath = "examples/nextcloud-filesharing";

function parseEnvironment(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    return match ? [[match[1], match[2]]] : [];
  }));
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
  return (command, args) => new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? done() : reject(new Error(`${command} exited with ${code ?? signal}`)));
  });
}

async function portAvailable(port) {
  const server = createServer();
  return new Promise((done) => {
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });
}

async function appiumReady(url) {
  try {
    const response = await fetch(new URL("status", url), { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.value?.ready !== false;
  } catch { return false; }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

async function verifiedApk(example, runtime) {
  const path = resolve(example, ".android", runtime.application.apk);
  const data = await readFile(path).catch(() => undefined);
  if (!data) throw new Error("Pinned Nextcloud APK is missing; run pnpm android:up first");
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== runtime.application.sha256) throw new Error("Pinned Nextcloud APK checksum is invalid; run pnpm android:up again");
  return path;
}

export async function appiumUp({
  root = repository,
  environment = process.env,
  port = 4723,
  capture: suppliedCapture,
  foreground: suppliedForeground,
  background,
  ready = appiumReady,
  alive = pidAlive,
  isPortAvailable = portAvailable,
  signal = (pid, name) => process.kill(-pid, name),
  pause = delay,
  log = console.log
} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Appium port must be an integer from 1 through 65535");
  const example = resolve(root, examplePath);
  const runtimeDirectory = resolve(example, ".runtime");
  const statePath = resolve(runtimeDirectory, "appium.json");
  const envPath = resolve(runtimeDirectory, "appium.env");
  const androidEnvironment = parseEnvironment(await readFile(resolve(runtimeDirectory, "android.env"), "utf8").catch(() => {
    throw new Error("Android runtime is not prepared; run pnpm android:up first");
  }));
  if (!androidEnvironment.ANDROID_UDID) throw new Error("Android runtime state does not contain ANDROID_UDID; run pnpm android:up again");
  const sdk = await findSdk(environment);
  const runtime = JSON.parse(await readFile(resolve(example, "android/runtime.json"), "utf8"));
  await verifiedApk(example, runtime);
  const env = { ...environment, ...androidEnvironment, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
  env.APPIUM_HOME ||= resolve(root, `.tmp/appium-${runtime.automation.appium}-${runtime.automation.uiautomator2}`);
  const capture = suppliedCapture ?? defaultCapture(env, root);
  const foreground = suppliedForeground ?? defaultForeground(env, root);
  const adb = resolve(sdk, "platform-tools/adb");
  const device = await capture(adb, ["-s", env.ANDROID_UDID, "get-state"], { optional: true });
  if (device.stdout.trim() !== "device") throw new Error(`Android device ${env.ANDROID_UDID} is not online; run pnpm android:up`);
  let existing;
  try { existing = JSON.parse(await readFile(statePath, "utf8")); } catch {}
  if (existing?.pid && alive(existing.pid)) {
    if (await ready(existing.url)) {
      await writeEnvironment(envPath, { APPIUM_URL: existing.url });
      log(`[appium:up] Reuse ${existing.url} (pid ${existing.pid})`);
      return existing;
    }
    throw new Error(`Recorded Appium process ${existing.pid} is running but not ready; run pnpm appium:down before retrying`);
  }
  await rm(statePath, { force: true });
  await rm(envPath, { force: true });
  if (!await isPortAvailable(port)) throw new Error(`Port ${port} is already in use; stop that service or pass --port <port>`);
  const appium = resolve(example, "node_modules/appium/index.js");
  const driverSource = resolve(example, "node_modules/appium-uiautomator2-driver");
  if (!existsSync(appium) || !existsSync(driverSource)) throw new Error("Appium dependencies are missing; run pnpm install first");
  await foreground(process.execPath, [resolve(example, "android/check-runtime.mjs")]);
  await mkdir(env.APPIUM_HOME, { recursive: true });
  const installed = JSON.parse((await capture(process.execPath, [appium, "driver", "list", "--installed", "--json"], { timeout: 60_000 })).stdout);
  const driver = installed.uiautomator2;
  if (driver && driver.version !== runtime.automation.uiautomator2) {
    throw new Error(`APPIUM_HOME contains UiAutomator2 ${driver.version}; expected ${runtime.automation.uiautomator2}`);
  }
  if (!driver) await foreground(process.execPath, [appium, "driver", "install", "--source=local", driverSource]);
  const logDirectory = resolve(root, ".tmp/appium-runtime");
  await mkdir(logDirectory, { recursive: true });
  const logPath = resolve(logDirectory, `appium-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const url = `http://127.0.0.1:${port}/`;
  let processState;
  if (background) processState = await background(process.execPath, [appium, "--address", "127.0.0.1", "--port", String(port), "--log-level", "warn", "--log", logPath], { env, cwd: root, logPath });
  else {
    const output = openSync(logPath, "a", 0o600);
    const child = spawn(process.execPath, [appium, "--address", "127.0.0.1", "--port", String(port), "--log-level", "warn", "--log", logPath], { cwd: root, env, detached: true, stdio: ["ignore", output, output] });
    closeSync(output);
    child.unref();
    processState = { pid: child.pid };
  }
  const state = { pid: processState.pid, port, url, logPath, appiumHome: env.APPIUM_HOME };
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  try {
    let available = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (!alive(state.pid)) throw new Error(`Appium exited before becoming ready; see ${logPath}`);
      if (await ready(url)) { available = true; break; }
      await pause(1_000);
    }
    if (!available) throw new Error(`Appium startup timed out; see ${logPath}`);
    await writeEnvironment(envPath, { APPIUM_URL: url });
    log(`[appium:up] Ready: ${url}; log: ${logPath}`);
    return state;
  } catch (error) {
    try { signal(state.pid, "SIGTERM"); } catch {}
    await rm(statePath, { force: true });
    await rm(envPath, { force: true });
    throw error;
  }
}

export async function appiumDown({
  root = repository,
  capture: suppliedCapture,
  alive = pidAlive,
  signal = (pid, name) => process.kill(-pid, name),
  pause = delay,
  log = console.log
} = {}) {
  const example = resolve(root, examplePath);
  const runtimeDirectory = resolve(example, ".runtime");
  const statePath = resolve(runtimeDirectory, "appium.json");
  const envPath = resolve(runtimeDirectory, "appium.env");
  let state;
  try { state = JSON.parse(await readFile(statePath, "utf8")); } catch {}
  try {
    if (!state?.pid || !alive(state.pid)) {
      log("[appium:down] Appium is not running");
      return;
    }
    const capture = suppliedCapture ?? defaultCapture(process.env, root);
    const command = await capture("ps", ["-p", String(state.pid), "-o", "command="], { optional: true });
    if (!command.stdout.includes("appium") || !command.stdout.includes(String(state.port))) {
      log(`[appium:down] Recorded pid ${state.pid} no longer belongs to this Appium runtime`);
      return;
    }
    log(`[appium:down] Stop ${state.url} (pid ${state.pid})`);
    try { signal(state.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    for (let attempt = 0; attempt < 50 && alive(state.pid); attempt++) await pause(100);
    if (alive(state.pid)) { try { signal(state.pid, "SIGKILL"); } catch {} }
  } finally {
    await rm(statePath, { force: true });
    await rm(envPath, { force: true });
  }
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--port") {
      const value = args[++index];
      if (!value || !/^\d+$/.test(value)) throw new Error("Missing or invalid value for --port");
      options.port = Number(value);
    } else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown option ${argument}`);
  }
  return options;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const action = process.argv[2];
  const options = parseArguments(process.argv.slice(3));
  if (options.help || !["up", "down"].includes(action)) {
    console.log("Usage: node android/appium.mjs <up|down> [--port <port>]");
    if (!options.help && action) process.exitCode = 2;
  } else {
    await (action === "up" ? appiumUp(options) : appiumDown(options)).catch((error) => {
      console.error(`[appium:${action}] ${error.message}`);
      process.exitCode = 1;
    });
  }
}
