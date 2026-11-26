import { runOwnedProcess } from "@openuji/journey-plugin/node";
import { platform } from "node:os";

/** The simulator pins a caller supplies directly in YAML `services.<key>.options`. */
export type IosRuntimeTarget = {
  simulator: string;
  deviceType: string;
  runtime: string;
  locale?: string;
};

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`ios target requires a nonempty ${label}`);
  return value.trim();
}

/** Validates presence and types; see validateIosTarget for cross-field consistency. */
export function parseIosTarget(options: Record<string, unknown>): IosRuntimeTarget {
  for (const key of Object.keys(options)) {
    if (!["simulator", "deviceType", "runtime", "locale"].includes(key)) {
      throw new Error(`Unknown ios target option ${key}`);
    }
  }
  const simulator = requireString(options.simulator, "simulator");
  const deviceType = requireString(options.deviceType, "deviceType");
  const runtime = requireString(options.runtime, "runtime");
  let locale: string | undefined;
  if (options.locale !== undefined) {
    if (typeof options.locale !== "string" || !options.locale.trim()) throw new Error("ios target locale must be a nonempty string");
    locale = options.locale.trim();
  }
  return { simulator, deviceType, runtime, ...(locale !== undefined ? { locale } : {}) };
}

/** Cross-field consistency for an iOS simulator target. */
export function validateIosTarget(target: IosRuntimeTarget): void {
  const validRuntime = /^(?:iOS[- ])?\d+(?:[.-]\d+)*$/i.test(target.runtime)
    || /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-\d+(?:-\d+)*$/.test(target.runtime);
  if (!validRuntime) {
    throw new Error(`Invalid iOS simulator runtime ${target.runtime}; expected an iOS version or com.apple.CoreSimulator.SimRuntime.iOS-* identifier`);
  }
  if (/^com\.apple\.CoreSimulator\.SimDeviceType\.(?:Apple-Watch|Apple-TV|Apple-Vision)/.test(target.deviceType)) {
    throw new Error(`iOS simulator target deviceType ${target.deviceType} is not an iPhone or iPad device type`);
  }
}

export type IosCaptureResult = { stdout: string; stderr: string; failed?: boolean };
export type IosCapture = (command: string, args: readonly string[], options?: { optional?: boolean; timeout?: number; onOutput?: (data: string) => void }) => Promise<IosCaptureResult>;

type SimctlRuntime = {
  identifier: string;
  name: string;
  version: string;
  isAvailable?: boolean;
};

type SimctlDeviceType = {
  identifier: string;
  name: string;
  productFamily?: string;
};

type SimctlDevice = {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
  deviceTypeIdentifier?: string;
};

type SimctlList = {
  runtimes?: SimctlRuntime[];
  devicetypes?: SimctlDeviceType[];
  devices?: Record<string, SimctlDevice[]>;
};

function defaultCapture(environment: NodeJS.ProcessEnv, cwd: string, signal?: AbortSignal): IosCapture {
  return async (command, args, options = {}) => {
    signal?.throwIfAborted();
    try {
      const stdout = await runOwnedProcess(command, args, {
        cwd,
        env: environment,
        signal,
        stdoutOnly: true,
        ...(options.onOutput ? { onOutput: options.onOutput } : {}),
        timeoutMs: options.timeout ?? 60_000
      });
      signal?.throwIfAborted();
      return { stdout, stderr: "" };
    } catch (error) {
      if (options.optional && !signal?.aborted) return { stdout: "", stderr: String(error), failed: true };
      throw error;
    }
  };
}

function normalizeVersionRuntimeId(runtime: string): string | undefined {
  const match = /^(?:iOS[- ])?(\d+(?:[.-]\d+)*)$/i.exec(runtime);
  if (!match) return undefined;
  return `com.apple.CoreSimulator.SimRuntime.iOS-${match[1]!.replaceAll(".", "-")}`;
}

function resolveRuntime(runtimes: readonly SimctlRuntime[], requested: string): SimctlRuntime {
  const normalizedId = normalizeVersionRuntimeId(requested);
  const available = runtimes.filter((item) => item.isAvailable !== false && item.identifier.includes(".iOS-"));
  const found = available.find((item) =>
    item.identifier === requested
    || item.name.toLowerCase() === requested.toLowerCase()
    || item.version === requested
    || (normalizedId !== undefined && item.identifier === normalizedId)
  );
  if (!found) {
    const names = available.map((item) => `${item.name} (${item.identifier})`).join(", ") || "none";
    throw new Error(`iOS simulator runtime ${requested} is not installed; available iOS runtimes: ${names}`);
  }
  return found;
}

function resolveDeviceType(deviceTypes: readonly SimctlDeviceType[], requested: string): SimctlDeviceType {
  const found = deviceTypes.find((item) => item.identifier === requested || item.name === requested);
  if (!found) {
    throw new Error(`iOS simulator deviceType ${requested} was not found in xcrun simctl devicetypes`);
  }
  return found;
}

export type IosUpOptions = {
  root?: string;
  target: IosRuntimeTarget;
  environment?: NodeJS.ProcessEnv;
  hostPlatform?: string;
  capture?: IosCapture;
  log?: (message: string) => void;
  /** Cancels provisioning and boot, compensating acquired resources. */
  signal?: AbortSignal;
};

/** Immutable acquisition accounting. `owned: false` denotes a borrowed simulator that was already booted. */
export type IosAcquisition = Readonly<{
  udid: string;
  simulator: string;
  deviceType: string;
  runtime: string;
  platformVersion: string;
  owned: boolean;
}>;

export async function iosUp({
  root = process.cwd(),
  target,
  environment = process.env,
  hostPlatform = platform(),
  capture: suppliedCapture,
  log = console.log,
  signal
}: IosUpOptions): Promise<IosAcquisition> {
  if (hostPlatform !== "darwin") throw new Error("ios:up requires macOS (darwin)");
  validateIosTarget(target);
  const capture = suppliedCapture ?? defaultCapture(environment, root, signal);
  const rawList = (await capture("xcrun", ["simctl", "list", "--json"])).stdout;
  const list = JSON.parse(rawList) as SimctlList;
  const resolvedRuntime = resolveRuntime(list.runtimes ?? [], target.runtime);
  const resolvedDeviceType = resolveDeviceType(list.devicetypes ?? [], target.deviceType);

  const matchingNamed: Array<{ runtimeId: string; device: SimctlDevice }> = [];
  for (const [runtimeId, devices] of Object.entries(list.devices ?? {})) {
    for (const device of devices) {
      if (device.isAvailable === false) continue;
      if (device.name === target.simulator) matchingNamed.push({ runtimeId, device });
    }
  }

  let udid: string;
  let alreadyBooted = false;

  if (matchingNamed.length > 0) {
    const exact = matchingNamed.find(({ runtimeId, device }) =>
      runtimeId === resolvedRuntime.identifier
      && (!device.deviceTypeIdentifier || device.deviceTypeIdentifier === resolvedDeviceType.identifier)
    );
    if (!exact) {
      const actual = matchingNamed[0]!;
      const mismatches: string[] = [];
      if (actual.runtimeId !== resolvedRuntime.identifier) mismatches.push(`runtime=${actual.runtimeId}`);
      if (actual.device.deviceTypeIdentifier && actual.device.deviceTypeIdentifier !== resolvedDeviceType.identifier) {
        mismatches.push(`deviceType=${actual.device.deviceTypeIdentifier}`);
      }
      throw new Error(`Simulator ${target.simulator} is incompatible (${mismatches.join(", ")}); remove it explicitly or choose another name`);
    }
    if (matchingNamed.length > 1) {
      throw new Error(`Multiple simulators named ${target.simulator} exist; remove duplicates explicitly or choose another name`);
    }
    udid = exact.device.udid;
    alreadyBooted = exact.device.state === "Booted";
  } else {
    log(`[ios:up] Create ${target.simulator} (${resolvedDeviceType.name}, ${resolvedRuntime.name})`);
    udid = (await capture("xcrun", ["simctl", "create", target.simulator, resolvedDeviceType.identifier, resolvedRuntime.identifier])).stdout.trim();
    if (!udid) throw new Error(`xcrun simctl create did not return a UDID for ${target.simulator}`);
  }

  if (alreadyBooted) {
    log(`[ios:up] Reuse ${target.simulator} (${udid})`);
    return Object.freeze({
      udid,
      simulator: target.simulator,
      deviceType: resolvedDeviceType.identifier,
      runtime: resolvedRuntime.identifier,
      platformVersion: resolvedRuntime.version,
      owned: false
    });
  }

  // Shutdown is attempted from the boot request on: a boot that hangs may still leave a booting device behind.
  let bootedByUs = false;
  const phase = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    log(`[ios:up] ${label}`);
    try {
      const result = await run();
      log(`[ios:up] ${label}: done in ${Math.round((Date.now() - started) / 1000)}s`);
      return result;
    } catch (error) {
      throw new Error(`iOS simulator ${target.simulator} (${udid}): ${label} failed after ${Math.round((Date.now() - started) / 1000)}s: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  };
  try {
    bootedByUs = true;
    await phase("requesting boot (simctl boot)", () => capture("xcrun", ["simctl", "boot", udid], { timeout: 300_000 }));
    await phase("waiting until the simulator is ready (simctl bootstatus)", () => capture("xcrun", ["simctl", "bootstatus", udid, "-b"], {
      timeout: 600_000,
      onOutput: (data) => { for (const line of data.split(/\r?\n/)) if (line.trim()) log(`[ios:up] bootstatus: ${line.trim()}`); }
    }));
    if (target.locale) {
      const appleLocale = target.locale.replaceAll("-", "_");
      const language = target.locale.split(/[-_]/)[0]!;
      await phase(`setting the locale to ${target.locale}`, async () => {
        // A freshly booted simulator stays slow to spawn processes, so these need the boot's time limit.
        await capture("xcrun", ["simctl", "spawn", udid, "defaults", "write", "NSGlobalDomain", "AppleLanguages", "-array", language], { timeout: 300_000 });
        await capture("xcrun", ["simctl", "spawn", udid, "defaults", "write", "NSGlobalDomain", "AppleLocale", "-string", appleLocale], { timeout: 300_000 });
      });
    }
    log(`[ios:up] Ready: ${target.simulator} (${udid})`);
    return Object.freeze({
      udid,
      simulator: target.simulator,
      deviceType: resolvedDeviceType.identifier,
      runtime: resolvedRuntime.identifier,
      platformVersion: resolvedRuntime.version,
      owned: true
    });
  } catch (error) {
    if (bootedByUs) {
      try {
        await releaseIosDevice({
          udid,
          simulator: target.simulator,
          deviceType: resolvedDeviceType.identifier,
          runtime: resolvedRuntime.identifier,
          platformVersion: resolvedRuntime.version,
          owned: true
        }, { capture: suppliedCapture });
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "iOS simulator startup and cleanup failed");
      }
    }
    throw error;
  }
}

export async function releaseIosDevice(
  device: IosAcquisition,
  options: { capture?: IosCapture; log?: (message: string) => void } = {}
): Promise<void> {
  if (!device.owned) return;
  const capture = options.capture ?? defaultCapture(process.env, process.cwd());
  options.log?.(`[ios:release] Shutdown ${device.simulator} (${device.udid})`);
  await capture("xcrun", ["simctl", "shutdown", device.udid], { optional: true, timeout: 60_000 });
}
