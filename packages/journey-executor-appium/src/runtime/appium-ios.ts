import { runOwnedProcess, spawnOwnedProcess } from "@openuji/journey-plugin/node";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ensureXcuitestDriver, ownXcuitestAutomationVersions, resolveAppiumEntry } from "./appium-server.js";
import { appiumDown, type AppiumState, type AppiumUpOptions } from "./appium.js";
import type { Capture, Foreground } from "./process.js";

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

/** Starts or reuses a local Appium server with XCUITest; never requires Android SDK tooling. */
export async function appiumIosUp({
  root = process.cwd(),
  environment = process.env,
  port = 4725,
  capture: suppliedCapture,
  foreground: suppliedForeground,
  background,
  ready = appiumReady,
  alive = pidAlive,
  isPortAvailable = portAvailable,
  signal = (pid, name) => process.kill(-pid, name),
  pause = delay,
  log = console.log,
  devices,
  statePath: suppliedStatePath,
  abortSignal
}: AppiumUpOptions = {}): Promise<AppiumState & { owned: boolean }> {
  abortSignal?.throwIfAborted();
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Appium port must be an integer from 1 through 65535");
  const runtimeDirectory = resolve(root, ".runtime");
  const statePath = suppliedStatePath ?? resolve(runtimeDirectory, "appium-ios.json");
  if (!devices?.length) throw new Error("Appium iOS needs at least one simulator device");

  const { appium: appiumVersion, xcuitest: xcuitestVersion } = await ownXcuitestAutomationVersions();
  const env: NodeJS.ProcessEnv = { ...environment };
  env.APPIUM_HOME ||= resolve(root, `.tmp/appium-${appiumVersion}-xcuitest-${xcuitestVersion}`);

  const rawCapture: Capture = suppliedCapture ?? (async (command, args, options = {}) => {
    try {
      return {
        stdout: await runOwnedProcess(command, args, { env, cwd: root, signal: abortSignal, stdoutOnly: true, timeoutMs: options.timeout ?? 30_000 }),
        stderr: ""
      };
    } catch (error) {
      if (options.optional && !abortSignal?.aborted) return { stdout: "", stderr: String(error), failed: true };
      throw error;
    }
  });
  const capture: Capture = async (...args) => {
    abortSignal?.throwIfAborted();
    const result = await rawCapture(...args);
    abortSignal?.throwIfAborted();
    return result;
  };
  const foreground: Foreground = suppliedForeground ?? (async (command, args) => {
    await runOwnedProcess(command, args, { env, cwd: root, signal: abortSignal, onOutput: log });
  });

  const simListRaw = (await capture("xcrun", ["simctl", "list", "devices", "--json"])).stdout;
  const simList = JSON.parse(simListRaw) as { devices?: Record<string, Array<{ udid: string; state: string }>> };
  const bootedUdids = new Set(
    Object.values(simList.devices ?? {})
      .flat()
      .filter((item) => item.state === "Booted")
      .map((item) => item.udid)
  );
  for (const udid of devices) {
    if (!bootedUdids.has(udid)) {
      throw new Error(`iOS simulator ${udid} is not booted; start the iOS simulator service first`);
    }
  }

  let existing: AppiumState | undefined;
  try { existing = JSON.parse(await readFile(statePath, "utf8")); } catch {}
  if (existing?.pid && alive(existing.pid)) {
    if (await ready(existing.url)) {
      log(`[appium:ios:up] Reuse ${existing.url} (pid ${existing.pid})`);
      if (existing.port !== port) throw new Error("Recorded Appium iOS port differs from configuration");
      return { ...existing, owned: false };
    }
    throw new Error(`Recorded Appium iOS process ${existing.pid} is running but not ready; stop it before retrying`);
  }
  await rm(statePath, { force: true });
  if (!await isPortAvailable(port)) throw new Error(`Port ${port} is already in use; stop that service or pass --port <port>`);

  const appium = resolveAppiumEntry();
  await ensureXcuitestDriver({ appiumHome: env.APPIUM_HOME, capture, foreground });
  const logDirectory = resolve(root, ".tmp/appium-ios-runtime");
  await mkdir(logDirectory, { recursive: true });
  const logPath = resolve(logDirectory, `appium-ios-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
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
      if (!alive(state.pid)) throw new Error(`Appium iOS exited before becoming ready; see ${logPath}`);
      if (await ready(url)) { available = true; break; }
      await pause(1_000);
    }
    if (!available) throw new Error(`Appium iOS startup timed out; see ${logPath}`);
    log(`[appium:ios:up] Ready: ${url}; log: ${logPath}`);
    return { ...state, owned: true };
  } catch (error) {
    try { await appiumDown({ root, statePath, state, alive, signal, pause, capture: suppliedCapture, log }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Appium iOS startup and cleanup failed"); }
    throw error;
  }
}
