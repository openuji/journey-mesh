import { findSdk } from "@openuji/journey-driver-android/runtime";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { ensureUiAutomator2Driver, ownAutomationVersions, resolveAppiumEntry } from "./appium-server.js";
import { defaultCapture, defaultForeground, type Capture, type Foreground } from "./process.js";

function parseEnvironment(source: string): Record<string, string> {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    return match ? [[match[1]!, match[2]!]] : [];
  }));
}

async function writeEnvironment(path: string, values: Record<string, string>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
  await rename(temporary, path);
}

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

type AppiumState = { pid: number; port: number; url: string; logPath: string; appiumHome: string };
export type BackgroundHandle = { pid: number };
export type Background = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string; logPath: string }
) => Promise<BackgroundHandle>;

export type AppiumUpOptions = {
  root?: string;
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
};

/** No example-specific knowledge: the Android device must already be online (.runtime/android.env). */
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
  log = console.log
}: AppiumUpOptions = {}): Promise<AppiumState> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Appium port must be an integer from 1 through 65535");
  const runtimeDirectory = resolve(root, ".runtime");
  const statePath = resolve(runtimeDirectory, "appium.json");
  const envPath = resolve(runtimeDirectory, "appium.env");
  const androidEnvironment = parseEnvironment(await readFile(resolve(runtimeDirectory, "android.env"), "utf8").catch(() => {
    throw new Error("Android runtime is not prepared; run pnpm android:up first");
  }));
  if (!androidEnvironment.ANDROID_UDID) throw new Error("Android runtime state does not contain ANDROID_UDID; run pnpm android:up again");
  const sdk = await findSdk(environment);
  const { appium: appiumVersion, uiautomator2: uiautomator2Version } = await ownAutomationVersions();
  const env: NodeJS.ProcessEnv = { ...environment, ...androidEnvironment, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
  env.APPIUM_HOME ||= resolve(root, `.tmp/appium-${appiumVersion}-${uiautomator2Version}`);
  const capture = suppliedCapture ?? defaultCapture(env, root);
  const foreground = suppliedForeground ?? defaultForeground(env, root);
  const adb = resolve(sdk, "platform-tools/adb");
  const device = await capture(adb, ["-s", androidEnvironment.ANDROID_UDID!, "get-state"], { optional: true });
  if (device.stdout.trim() !== "device") throw new Error(`Android device ${androidEnvironment.ANDROID_UDID} is not online; run pnpm android:up`);
  let existing: AppiumState | undefined;
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
  const appium = resolveAppiumEntry();
  await ensureUiAutomator2Driver({ appiumHome: env.APPIUM_HOME, capture, foreground });
  const logDirectory = resolve(root, ".tmp/appium-runtime");
  await mkdir(logDirectory, { recursive: true });
  const logPath = resolve(logDirectory, `appium-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const url = `http://127.0.0.1:${port}/`;
  let processState: BackgroundHandle;
  const args = [appium, "--address", "127.0.0.1", "--port", String(port), "--log-level", "warn", "--log", logPath];
  if (background) processState = await background(process.execPath, args, { env, cwd: root, logPath });
  else {
    const output = openSync(logPath, "a", 0o600);
    const child = spawn(process.execPath, args, { cwd: root, env, detached: true, stdio: ["ignore", output, output] });
    closeSync(output);
    child.unref();
    processState = { pid: child.pid! };
  }
  const state: AppiumState = { pid: processState.pid, port, url, logPath, appiumHome: env.APPIUM_HOME };
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

export type AppiumDownOptions = {
  root?: string;
  capture?: Capture;
  alive?: (pid: number) => boolean;
  signal?: (pid: number, name: NodeJS.Signals) => void;
  pause?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

export async function appiumDown({
  root = process.cwd(),
  capture: suppliedCapture,
  alive = pidAlive,
  signal = (pid, name) => process.kill(-pid, name),
  pause = delay,
  log = console.log
}: AppiumDownOptions = {}): Promise<void> {
  const runtimeDirectory = resolve(root, ".runtime");
  const statePath = resolve(runtimeDirectory, "appium.json");
  const envPath = resolve(runtimeDirectory, "appium.env");
  let state: AppiumState | undefined;
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
    try { signal(state.pid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    for (let attempt = 0; attempt < 50 && alive(state.pid); attempt++) await pause(100);
    if (alive(state.pid)) { try { signal(state.pid, "SIGKILL"); } catch {} }
  } finally {
    await rm(statePath, { force: true });
    await rm(envPath, { force: true });
  }
}
