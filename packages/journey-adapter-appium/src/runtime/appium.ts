import { runOwnedProcess, spawnOwnedProcess } from "@openuji/journey-plugin/node";
import { findSdk } from "@openuji/journey-driver-android/service";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ensureUiAutomator2Driver, ownAutomationVersions, resolveAppiumEntry } from "./appium-server.js";
import { defaultCapture, type Capture, type Foreground } from "./process.js";

async function portAvailable(port: number): Promise<boolean> {
  const server = createServer();
  return new Promise((done) => {
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });
}

async function appiumReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("status", url), { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return false;
    const body = await response.json() as { value?: { ready?: boolean } };
    return body?.value?.ready !== false;
  } catch { return false; }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

export type AppiumState = { pid: number; port: number; url: string; logPath: string; appiumHome: string };
export type BackgroundHandle = { pid: number };
export type Background = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string; logPath: string }
) => Promise<BackgroundHandle>;

export type AppiumUpOptions = {
  root?: string;
  statePath?: string;
  abortSignal?: AbortSignal;
  environment?: NodeJS.ProcessEnv;
  port?: number;
  capture?: Capture;
  foreground?: Foreground;
  background?: Background;
  ready?: (url: string) => Promise<boolean>;
  alive?: (pid: number) => boolean;
  isPortAvailable?: (port: number) => Promise<boolean>;
  signal?: (pid: number, name: NodeJS.Signals) => void;
  pause?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  /** Device UDIDs that must be online; without them, the one recorded in .runtime/android.env. */
  devices?: readonly string[];
};

/** No example-specific knowledge: the Android devices must already be online. */
export async function appiumUp({
  root = process.cwd(),
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
  log = console.log,
  devices, statePath: suppliedStatePath, abortSignal
}: AppiumUpOptions = {}): Promise<AppiumState & { owned: boolean }> {
  abortSignal?.throwIfAborted();
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Appium port must be an integer from 1 through 65535");
  const runtimeDirectory = resolve(root, ".runtime");
  const statePath = suppliedStatePath ?? resolve(runtimeDirectory, "appium.json");
  if (!devices?.length) throw new Error("Appium needs at least one Android device");
  const sdk = await findSdk(environment);
  const { appium: appiumVersion, uiautomator2: uiautomator2Version } = await ownAutomationVersions();
  const env: NodeJS.ProcessEnv = { ...environment, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
  env.APPIUM_HOME ||= resolve(root, `.tmp/appium-${appiumVersion}-${uiautomator2Version}`);
  const rawCapture: Capture = suppliedCapture ?? (async (command, args, options = {}) => {
    try { return { stdout: await runOwnedProcess(command, args, { env, cwd: root, signal: abortSignal, timeoutMs: options.timeout ?? 30000 }), stderr: "" }; }
    catch (error) { if (options.optional && !abortSignal?.aborted) return { stdout: "", stderr: String(error), failed: true }; throw error; }
  });
  const capture: Capture = async (...args) => { abortSignal?.throwIfAborted(); const result = await rawCapture(...args); abortSignal?.throwIfAborted(); return result; };
  const foreground = suppliedForeground ?? (async (command, args) => { await runOwnedProcess(command, args, { env, cwd: root, signal: abortSignal, onOutput: log }); });
  const adb = resolve(sdk, "platform-tools/adb");
  for (const udid of devices) {
    const device = await capture(adb, ["-s", udid, "get-state"], { optional: true });
    if (device.stdout.trim() !== "device") throw new Error(`Android device ${udid} is not online; start the Android service first`);
  }
  let existing: AppiumState | undefined;
  try { existing = JSON.parse(await readFile(statePath, "utf8")); } catch {}
  if (existing?.pid && alive(existing.pid)) {
    if (await ready(existing.url)) {
      log(`[appium:up] Reuse ${existing.url} (pid ${existing.pid})`);
      if (existing.port !== port) throw new Error("Recorded Appium port differs from configuration");
      return { ...existing, owned: false };
    }
    throw new Error(`Recorded Appium process ${existing.pid} is running but not ready; run pnpm appium:down before retrying`);
  }
  await rm(statePath, { force: true });
  if (!await isPortAvailable(port)) throw new Error(`Port ${port} is already in use; stop that service or pass --port <port>`);
  const appium = resolveAppiumEntry();
  await ensureUiAutomator2Driver({ appiumHome: env.APPIUM_HOME, capture, foreground });
  const logDirectory = resolve(root, ".tmp/appium-runtime");
  await mkdir(logDirectory, { recursive: true });
  const logPath = resolve(logDirectory, `appium-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const url = `http://127.0.0.1:${port}/`;
  const args = [appium, "--address", "127.0.0.1", "--port", String(port), "--log-level", "warn:debug", "--log", logPath];
  const processState = await (background ?? spawnOwnedProcess)(process.execPath, args, { env, cwd: root, logPath });
  const state: AppiumState = { pid: processState.pid, port, url, logPath, appiumHome: env.APPIUM_HOME };
  try {
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
    let available = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      abortSignal?.throwIfAborted();
      if (!alive(state.pid)) throw new Error(`Appium exited before becoming ready; see ${logPath}`);
      if (await ready(url)) { available = true; break; }
      await pause(1_000);
    }
    if (!available) throw new Error(`Appium startup timed out; see ${logPath}`);
    log(`[appium:up] Ready: ${url}; log: ${logPath}`);
    return { ...state, owned: true };
  } catch (error) {
    try { await appiumDown({ root, statePath, state, alive, signal, pause, capture: suppliedCapture, log }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Appium startup and cleanup failed"); }
    throw error;
  }
}

export type AppiumDownOptions = {
  root?: string;
  statePath?: string;
  state?: AppiumState;
  capture?: Capture;
  alive?: (pid: number) => boolean;
  signal?: (pid: number, name: NodeJS.Signals) => void;
  pause?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

export async function appiumDown({
  root = process.cwd(), capture: suppliedCapture, alive = pidAlive,
  signal = (pid, name) => process.kill(-pid, name), pause = delay,
  log = console.log, statePath: suppliedStatePath, state: suppliedState
}: AppiumDownOptions = {}): Promise<void> {
  const statePath = suppliedStatePath ?? resolve(root, ".runtime/appium.json");
  let state = suppliedState;
  if (!state) try { state = JSON.parse(await readFile(statePath, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!state?.pid || !alive(state.pid)) {
    log("[appium:down] Appium is not running");
    await rm(statePath, { force: true });
    return;
  }
  const capture = suppliedCapture ?? defaultCapture(process.env, root);
  const command = await capture("ps", ["-p", String(state.pid), "-o", "command="], { optional: true });
  if (!command.stdout.includes("appium") || !command.stdout.includes(String(state.port))) {
    log(`[appium:down] Recorded pid ${state.pid} no longer belongs to this Appium runtime`);
    await rm(statePath, { force: true });
    return;
  }
  log(`[appium:down] Stop ${state.url} (pid ${state.pid})`);
  for (const name of ["SIGTERM", "SIGKILL"] as const) {
    if (!alive(state.pid)) break;
    try { signal(state.pid, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    for (let attempt = 0; attempt < 50 && alive(state.pid); attempt++) await pause(100);
  }
  if (alive(state.pid)) throw new Error(`Appium process ${state.pid} did not stop`);
  // A failed stop retains the record so explicit shutdown can retry.
  await rm(statePath, { force: true });
}
