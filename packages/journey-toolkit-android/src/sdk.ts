import { runOwnedProcess, spawnOwnedProcess, stopProcessGroup } from "@openuji/journey-plugin/node";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { arch, homedir, platform } from "node:os";
import { delimiter, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** The device pins a caller supplies — directly, as YAML `services.<key>.options`, not a separate file. */
export type AndroidRuntimeTarget = {
  api: number;
  avd: string;
  image: string;
  localImages?: Readonly<Record<string, string>>;
  profile: string;
  locale?: string;
  /** Packages the booted image must already include (e.g. a companion browser). */
  requiredPackages?: readonly string[];
  /** Host TCP ports the device reaches as its own `localhost:<port>` (adb reverse), e.g. a local server stack. */
  reversePorts?: readonly number[];
};

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`android target requires a nonempty ${label}`);
  return value;
}

/** Validates presence/type only; see validateAndroidTarget for cross-field consistency. */
export function parseAndroidTarget(options: Record<string, unknown>): AndroidRuntimeTarget {
  const api = options.api;
  if (typeof api !== "number" || !Number.isInteger(api) || api <= 0) throw new Error("android target requires a positive integer api");
  const avd = requireString(options.avd, "avd");
  const image = requireString(options.image, "image");
  const profile = requireString(options.profile, "profile");
  let localImages: Record<string, string> | undefined;
  if (options.localImages !== undefined) {
    if (!options.localImages || typeof options.localImages !== "object" || Array.isArray(options.localImages)) {
      throw new Error("android target localImages must be an object");
    }
    localImages = Object.fromEntries(Object.entries(options.localImages).map(([key, value]) => [key, requireString(value, `localImages.${key}`)]));
  }
  let locale: string | undefined;
  if (options.locale !== undefined) {
    if (typeof options.locale !== "string") throw new Error("android target locale must be a string");
    locale = options.locale;
  }
  let requiredPackages: readonly string[] | undefined;
  if (options.requiredPackages !== undefined) {
    if (!Array.isArray(options.requiredPackages)) throw new Error("android target requiredPackages must be an array");
    requiredPackages = options.requiredPackages.map((value: unknown, index: number) => requireString(value, `requiredPackages[${index}]`));
  }
  let reversePorts: readonly number[] | undefined;
  if (options.reversePorts !== undefined) {
    if (!Array.isArray(options.reversePorts)) throw new Error("android target reversePorts must be an array");
    reversePorts = options.reversePorts.map((value: unknown) => {
      const port = typeof value === "string" ? Number(value) : value;
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("android target reversePorts must be TCP ports");
      return port;
    });
  }
  return {
    api, avd, image, ...(localImages ? { localImages } : {}), profile,
    ...(locale !== undefined ? { locale } : {}), ...(requiredPackages ? { requiredPackages } : {}), ...(reversePorts ? { reversePorts } : {})
  };
}

/** Cross-field consistency only — generic to any Android target, not this example's own locale/binding choices. */
export function validateAndroidTarget(target: AndroidRuntimeTarget): void {
  for (const image of [target.image, ...Object.values(target.localImages ?? {})]) {
    const [kind, imagePlatform, imageTarget, imageAbi, extra] = image.split(";");
    if (kind !== "system-images" || imagePlatform !== `android-${target.api}` || !imageTarget || !imageAbi || extra !== undefined) {
      throw new Error("Android target API level and system image disagree");
    }
  }
}

export type CaptureResult = { stdout: string; stderr: string; failed?: boolean };
export type Capture = (command: string, args: readonly string[], options?: { optional?: boolean; timeout?: number }) => Promise<CaptureResult>;
export type Foreground = (command: string, args: readonly string[], options?: { input?: string }) => Promise<void>;
export type BackgroundHandle = { pid: number };
export type Background = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; cwd: string; logPath: string }
) => Promise<BackgroundHandle>;

export function selectSystemImage(target: AndroidRuntimeTarget, hostPlatform: string = platform(), hostArch: string = arch()): string {
  const key = `${hostPlatform}-${hostArch}`;
  const image = target.localImages?.[key];
  if (!image) throw new Error(`Unsupported Android emulator host ${key}; supported hosts: ${Object.keys(target.localImages ?? {}).join(", ")}`);
  return image;
}

export async function findSdk(environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  const explicit = environment.ANDROID_HOME || environment.ANDROID_SDK_ROOT;
  const candidates = explicit ? [explicit] : [resolve(homedir(), "Library/Android/sdk"), resolve(homedir(), "Android/Sdk")];
  for (const candidate of candidates) {
    try { await readFile(resolve(candidate, "package.xml")); return resolve(candidate); }
    catch { if (existsSync(candidate)) return resolve(candidate); }
  }
  throw new Error(`Android SDK was not found${explicit ? ` at ${explicit}` : ""}; install Android Studio and set ANDROID_HOME`);
}

export function androidAvdHome(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.ANDROID_AVD_HOME) return resolve(environment.ANDROID_AVD_HOME);
  return resolve(environment.ANDROID_EMULATOR_HOME || environment.ANDROID_USER_HOME || resolve(homedir(), ".android"), "avd");
}

export async function findSdkTool(sdk: string, name: string): Promise<string | undefined> {
  const candidates = [resolve(sdk, "cmdline-tools/latest/bin", name), resolve(sdk, "tools/bin", name)];
  try {
    const entries = await readdir(resolve(sdk, "cmdline-tools"));
    entries.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    candidates.push(...entries.map((entry) => resolve(sdk, "cmdline-tools", entry, "bin", name)));
  } catch {}
  return candidates.find(existsSync);
}

function studioHomes(environment: NodeJS.ProcessEnv, hostPlatform: string): string[] {
  const configured = environment.ANDROID_STUDIO_HOME ? [resolve(environment.ANDROID_STUDIO_HOME)] : [];
  if (hostPlatform === "darwin") configured.push("/Applications/Android Studio.app/Contents");
  if (hostPlatform === "linux") configured.push("/opt/android-studio", "/usr/local/android-studio");
  return configured;
}

async function commandOnPath(name: string, capture: Capture): Promise<string | undefined> {
  try { return (await capture("which", [name])).stdout.trim() || undefined; }
  catch { return undefined; }
}

export async function findAndroidCli(environment: NodeJS.ProcessEnv, hostPlatform: string, capture: Capture): Promise<string | undefined> {
  if (environment.ANDROID_CLI && existsSync(environment.ANDROID_CLI)) return resolve(environment.ANDROID_CLI);
  const found = await commandOnPath("android", capture);
  if (found) return found;
  for (const home of studioHomes(environment, hostPlatform)) {
    const candidate = resolve(home, "plugins/android/resources/android-cli/bin/android");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function javaHome(environment: NodeJS.ProcessEnv, hostPlatform: string): string | undefined {
  if (environment.JAVA_HOME) return environment.JAVA_HOME;
  for (const home of studioHomes(environment, hostPlatform)) {
    const candidate = hostPlatform === "darwin" ? resolve(home, "jbr/Contents/Home") : resolve(home, "jbr");
    if (existsSync(resolve(candidate, "bin/java"))) return candidate;
  }
  return undefined;
}

type Device = { serial: string; state: string };

function parseDevices(output: string): Device[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^(\S+)\s+(device|offline|unauthorized)\b/.exec(line);
    return match ? [{ serial: match[1]!, state: match[2]! }] : [];
  });
}

async function matchingDevices(adb: string, avd: string, capture: Capture): Promise<{ devices: Device[]; matches: string[] }> {
  const devices = parseDevices((await capture(adb, ["devices"])).stdout);
  const matches: string[] = [];
  for (const device of devices) {
    if (!device.serial.startsWith("emulator-") || device.state !== "device") continue;
    const result = await capture(adb, ["-s", device.serial, "emu", "avd", "name"], { optional: true });
    if (result.stdout.split(/\r?\n/)[0]!.trim() === avd) matches.push(device.serial);
  }
  return { devices, matches };
}

function parseIni(source: string): Record<string, string> {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const index = line.indexOf("=");
    return index > 0 ? [[line.slice(0, index), line.slice(index + 1)]] : [];
  }));
}

export async function validateAvd({ avd, avdHome, target, image }: {
  avd: string; avdHome: string; target: AndroidRuntimeTarget; image: string;
}): Promise<void> {
  const configPath = resolve(avdHome, `${avd}.avd/config.ini`);
  const config = parseIni(await readFile(configPath, "utf8"));
  const [, expectedPlatform, expectedTarget, expectedAbi] = image.split(";");
  const mismatches: string[] = [];
  if (config.target !== expectedPlatform) mismatches.push(`target=${config.target || "missing"}`);
  if (config["tag.id"] !== expectedTarget) mismatches.push(`tag=${config["tag.id"] || "missing"}`);
  if (config["abi.type"] !== expectedAbi) mismatches.push(`abi=${config["abi.type"] || "missing"}`);
  if (config["hw.device.name"] !== target.profile) mismatches.push(`device=${config["hw.device.name"] || "missing"}`);
  if (mismatches.length) throw new Error(`AVD ${avd} is incompatible (${mismatches.join(", ")}); remove it explicitly or choose another name`);
}

async function portAvailable(port: number): Promise<boolean> {
  const server = createServer();
  return new Promise((done) => {
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });
}

async function emulatorPort(): Promise<number> {
  for (let port = 5554; port <= 5584; port += 2) {
    if (await portAvailable(port) && await portAvailable(port + 1)) return port;
  }
  throw new Error("No free emulator port pair was found from 5554 through 5584");
}

function defaultCapture(environment: NodeJS.ProcessEnv, cwd: string): Capture {
  return async (command, args, options = {}) => {
    try { return { stdout: await runOwnedProcess(command, args, { cwd, env: environment, timeoutMs: options.timeout ?? 30000 }), stderr: "" }; }
    catch (error) { if (options.optional) return { stdout: "", stderr: String(error), failed: true }; throw error; }
  };
}

async function provisionSdk({ sdk, image, environment, hostPlatform, capture, foreground }: {
  sdk: string; image: string; environment: NodeJS.ProcessEnv; hostPlatform: string; capture: Capture; foreground: Foreground;
}): Promise<{ avdmanager: string }> {
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

export type AndroidUpOptions = {
  root?: string;
  target: AndroidRuntimeTarget;
  environment?: NodeJS.ProcessEnv;
  hostPlatform?: string;
  hostArch?: string;
  capture?: Capture;
  foreground?: Foreground;
  background?: Background;
  choosePort?: () => Promise<number>;
  pause?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  avdHome?: string;
  /** Cancels provisioning and boot, with compensation for acquired resources. */
  signal?: AbortSignal;
};

export async function androidUp({
  root = process.cwd(),
  target,
  environment = process.env,
  hostPlatform = platform(),
  hostArch = arch(),
  capture: suppliedCapture,
  foreground: suppliedForeground,
  background,
  choosePort = emulatorPort,
  pause = delay,
  log = console.log,
  avdHome: suppliedAvdHome,
  signal
}: AndroidUpOptions): Promise<AndroidAcquisition> {
  if (!["darwin", "linux"].includes(hostPlatform)) throw new Error("android:up supports macOS and Linux");
  validateAndroidTarget(target);
  const avd = target.avd;
  const image = selectSystemImage(target, hostPlatform, hostArch);
  const sdk = await findSdk(environment);
  const avdHome = resolve(suppliedAvdHome ?? androidAvdHome(environment));
  const env: NodeJS.ProcessEnv = { ...environment, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_AVD_HOME: avdHome };
  const discoveredJava = javaHome(env, hostPlatform);
  if (discoveredJava) { env.JAVA_HOME = discoveredJava; env.PATH = [resolve(discoveredJava, "bin"), env.PATH ?? ""].join(delimiter); }
  env.PATH = [resolve(sdk, "platform-tools"), resolve(sdk, "emulator"), env.PATH ?? ""].join(delimiter);
  const rawCapture = suppliedCapture ?? ((command, args, options = {}) => runOwnedProcess(command, args, { cwd: root, env, signal, timeoutMs: options.timeout ?? 30000 })
    .then((stdout) => ({ stdout, stderr: "" }), (error: unknown) => { if (options.optional && !signal?.aborted) return { stdout: "", stderr: String(error), failed: true }; throw error; })) as Capture;
  const capture: Capture = async (...args) => { signal?.throwIfAborted(); const result = await rawCapture(...args); signal?.throwIfAborted(); return result; };
  const foreground: Foreground = suppliedForeground ?? (async (command, args, options) => { await runOwnedProcess(command, args, { cwd: root, env, signal, input: options?.input, onOutput: (text) => log(text) }); });
  log(`[android:up] SDK: ${sdk}; image: ${image}; AVD: ${avd}`);
  const { avdmanager } = await provisionSdk({ sdk, image, environment: env, hostPlatform, capture, foreground });
  const emulator = resolve(sdk, "emulator/emulator");
  const adb = resolve(sdk, "platform-tools/adb");
  await mkdir(avdHome, { recursive: true });
  const configured = (await capture(emulator, ["-list-avds"])).stdout.split(/\r?\n/).filter(Boolean);
  if (configured.includes(avd)) await validateAvd({ avd, avdHome, target, image });
  else {
    log(`[android:up] Create ${avd}`);
    await foreground(avdmanager, ["create", "avd", "--name", avd, "--path", resolve(avdHome, `${avd}.avd`), "--package", image, "--device", target.profile], { input: "no\n" });
    await validateAvd({ avd, avdHome, target, image });
  }
  await capture(emulator, ["-accel-check"]);
  await capture(adb, ["start-server"]);
  const found = await matchingDevices(adb, avd, capture);
  let serial = environment.ANDROID_UDID && found.matches.includes(environment.ANDROID_UDID) ? environment.ANDROID_UDID : found.matches[0];
  let owned: { pid: number } | undefined;
  let logPath: string | undefined;
  if (!serial) {
    const port = await choosePort();
    serial = `emulator-${port}`;
    const logDirectory = resolve(root, ".tmp/android-runtime");
    await mkdir(logDirectory, { recursive: true });
    logPath = resolve(logDirectory, `emulator-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    log(`[android:up] Boot ${avd} as ${serial}; log: ${logPath}`);
    owned = await (background ?? spawnOwnedProcess)(emulator, ["-avd", avd, "-port", String(port), "-no-snapshot", "-no-boot-anim", "-no-window", "-no-audio", "-gpu", "swiftshader", "-feature", "-Vulkan"], { env, cwd: root, logPath });
  } else log(`[android:up] Reuse ${serial}`);
  let reversePorts: readonly number[] = Object.freeze([]);
  try {
    let booted = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      const boot = await capture(adb, ["-s", serial, "shell", "getprop", "sys.boot_completed"], { optional: true, timeout: 5_000 });
      if (boot.stdout.trim() === "1") { booted = true; break; }
      signal?.throwIfAborted();
      await pause(2_000);
    }
    if (!booted) throw new Error(`Timed out waiting for ${serial} to boot${logPath ? `; see ${logPath}` : ""}`);
    const api = (await capture(adb, ["-s", serial, "shell", "getprop", "ro.build.version.sdk"])).stdout.trim();
    if (api !== String(target.api)) throw new Error(`AVD ${avd} booted API ${api}; expected ${target.api}`);
    for (const requiredPackage of target.requiredPackages ?? []) {
      const found = await capture(adb, ["-s", serial, "shell", "pm", "path", requiredPackage]);
      if (!found.stdout.includes("package:")) throw new Error(`AVD ${avd} does not include ${requiredPackage}`);
    }
    await capture(adb, ["-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
    await capture(adb, ["-s", serial, "shell", "wm", "dismiss-keyguard"]);
    for (const setting of ["window_animation_scale", "transition_animation_scale", "animator_duration_scale"]) {
      await capture(adb, ["-s", serial, "shell", "settings", "put", "global", setting, "0"]);
    }
    const mappings = (target.reversePorts?.length ? (await capture(adb, ["-s", serial, "reverse", "--list"])).stdout : "").split(/\r?\n/);
    for (const port of target.reversePorts ?? []) {
      const existing = mappings.map((line) => line.trim().split(/\s+/)).find((fields) => fields[1] === `tcp:${port}`);
      if (existing) { if (existing[2] !== `tcp:${port}`) throw new Error(`Reverse port ${port} is already mapped elsewhere`); continue; }
      await capture(adb, ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
      reversePorts = [...reversePorts, port];
    }
    log(`[android:up] Ready: ${serial}`);
    return Object.freeze({ serial, avd, image, ...(owned ? { pid: owned.pid } : {}), reversePorts, sdk });
  } catch (error) {
    try { await releaseAndroidDevice({ serial, avd, image, sdk, ...(owned ? { pid: owned.pid } : {}), reversePorts }, { capture: suppliedCapture }); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Android startup and cleanup failed"); }
    throw error;
  }
}

/** Immutable acquisition accounting. A missing pid denotes a borrowed emulator. */
export type AndroidAcquisition = Readonly<{ serial: string; avd: string; image: string; sdk: string; pid?: number; reversePorts: readonly number[] }>;
export async function releaseAndroidDevice(device: AndroidAcquisition, options: { capture?: Capture; stop?: (pid: number) => Promise<void>; log?: (message: string) => void } = {}): Promise<void> {
  const adb = resolve(device.sdk, "platform-tools/adb");
  const capture = options.capture ?? defaultCapture(process.env, process.cwd());
  const failures: unknown[] = [];
  try {
    const { matches } = await matchingDevices(adb, device.avd, capture);
    const online = matches.includes(device.serial);
    const mappings = (online ? (await capture(adb, ["-s", device.serial, "reverse", "--list"], { optional: true })).stdout : "").split(/\r?\n/).map((line) => line.trim().split(/\s+/));
    for (const port of device.reversePorts) if (mappings.some((fields) => fields[1] === `tcp:${port}` && fields[2] === `tcp:${port}`)) {
      await capture(adb, ["-s", device.serial, "reverse", "--remove", `tcp:${port}`], { optional: true });
    }
  } catch (error) { failures.push(error); }
  // Process ownership is independent of ADB availability. Borrowed devices have no pid.
  try {
    if (device.pid) {
      const command = await capture("ps", ["-p", String(device.pid), "-o", "command="], { optional: true });
      if (command.stdout.includes("emulator") && command.stdout.includes(device.avd)) {
        options.log?.(`[android:release] Stop ${device.avd} (${device.serial})`);
        await (options.stop ?? stopProcessGroup)(device.pid);
      }
    }
  } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, `Android cleanup failed: ${failures.map(String).join("; ")}`);
}
