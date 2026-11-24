import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runOwnedProcess } from "@openuji/journey-plugin/node";
import { findSdk } from "./sdk.js";

export type JdkInstallation = Readonly<{ major: number; home: string; version: string }>;
export type ApkBuildToolchain = Readonly<{ sdk: string; javaHome: string; javaVersion: string; aapt2: string; apksigner: string; fingerprint: string; installations: readonly JdkInstallation[] }>;
export type ApkBuildRunner = (command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv; logPath: string; signal?: AbortSignal }) => Promise<void>;

function javaMajor(text: string): number | undefined {
  const version = /version "([^"]+)"/.exec(text)?.[1];
  if (!version) return undefined;
  const [first, second] = version.split(".");
  return Number(first === "1" ? second : first);
}

/** Run a short host tool and return its output; bounded so a hung tool cannot stall a build. */
export const captureTool = (command: string, args: readonly string[], signal?: AbortSignal) => runOwnedProcess(command, args, { signal, timeoutMs: 30000 });

async function jdkVersion(home: string, signal?: AbortSignal): Promise<{ major?: number; version?: string }> {
  const text = await captureTool(join(home, "bin/java"), ["-version"], signal);
  return { major: javaMajor(text), version: /version "([^"]+)"/.exec(text)?.[1] };
}

/**
 * A further JDK for Gradle toolchains: `JAVA_HOME_<major>_X64`, `_ARM64` or `JAVA_HOME_<major>`
 * (the variables `actions/setup-java` sets), else macOS `java_home -v <major>`.
 */
export async function findJdk(major: number, environment: NodeJS.ProcessEnv = process.env, hostPlatform: string = process.platform, signal?: AbortSignal): Promise<JdkInstallation> {
  const candidates = [`JAVA_HOME_${major}_X64`, `JAVA_HOME_${major}_ARM64`, `JAVA_HOME_${major}`].map((name) => environment[name]).filter((value): value is string => !!value);
  if (!candidates.length && hostPlatform === "darwin") {
    const found = await captureTool("/usr/libexec/java_home", ["-v", String(major)], signal).then((output) => output.trim(), () => { signal?.throwIfAborted(); return ""; });
    if (found) candidates.push(found);
  }
  for (const home of candidates) {
    if (!existsSync(join(home, "bin/java"))) continue;
    const { major: found, version } = await jdkVersion(home, signal);
    if (found === major && version) return Object.freeze({ major, home, version });
  }
  throw new Error(`No JDK ${major} found; set JAVA_HOME_${major}_X64 or JAVA_HOME_${major}_ARM64 to one`);
}

/** JAVA_HOME must hold the pinned JDK major; aapt2 comes from the newest installed build-tools. */
export async function hostToolchain(javaVersion: number, toolchains: readonly number[] = [], environment: NodeJS.ProcessEnv = process.env, signal?: AbortSignal): Promise<ApkBuildToolchain> {
  const sdk = await findSdk(environment);
  const javaHome = environment.JAVA_HOME;
  if (!javaHome || !existsSync(join(javaHome, "bin/java"))) throw new Error(`Set JAVA_HOME to a JDK ${javaVersion}`);
  const { major, version } = await jdkVersion(javaHome, signal);
  if (major !== javaVersion || !version) throw new Error(`JAVA_HOME is JDK ${major ?? "unknown"}; this build requires JDK ${javaVersion}`);
  const installations: JdkInstallation[] = [];
  for (const toolchain of toolchains) installations.push(await findJdk(toolchain, environment, process.platform, signal));
  const buildTools = join(sdk, "build-tools");
  const versions = existsSync(buildTools) ? (await readdir(buildTools)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) : [];
  const aapt2 = versions.map((version) => join(buildTools, version, "aapt2")).find(existsSync);
  if (!aapt2) throw new Error(`No aapt2 found under ${buildTools}; install Android build-tools`);
  const apksigner = join(aapt2, "../apksigner");
  if (!existsSync(apksigner)) throw new Error("Android build-tools must include apksigner");
  const fingerprint = createHash("sha256").update(JSON.stringify(await Promise.all([
    javaHome, ...installations.map((jdk) => jdk.home)
  ].map(async (home) => ({ release: await readFile(join(home, "release"), "utf8"), java: await fileSha256(join(home, "bin/java")) }))))).update(await fileSha256(aapt2)).update(await fileSha256(apksigner)).digest("hex");
  return Object.freeze({ sdk, javaHome, javaVersion: version, aapt2, apksigner, fingerprint, installations: Object.freeze(installations) });
}

/** Gradle output goes to `logPath`; failures report its tail. The whole process group stops on abort. */
export const runGradle: ApkBuildRunner = async (command, args, { cwd, env, logPath, signal }) => {
  await writeFile(logPath, "", { mode: 0o600 });
  // Synchronous delivery order is retained by chaining file writes inside this effect boundary.
  let writes = Promise.resolve();
  try { await runOwnedProcess(command, args, { cwd, env, signal, onOutput: (text) => { writes = writes.then(() => appendFile(logPath, text)); } }); }
  finally { await writes; }
};

export async function fileSha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
