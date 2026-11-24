import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, delimiter, isAbsolute, join, normalize, resolve } from "node:path";
import { startedService, sourceIdentity, type JourneyService, type SourceCheckout, type SourceIdentity } from "@openuji/journey-plugin";
import { readJsonRecord, writeJsonRecord } from "@openuji/journey-plugin/node";
import type { AndroidApk } from "@openuji/journey-platform-android";
import { captureTool as capture, fileSha256 as sha256, hostToolchain, parseBadging, runGradle, type ApkBuildRunner, type ApkBuildToolchain } from "@openuji/journey-toolkit-android";
import { gradleObservations } from "./gradle-observations.js";

/**
 * Gradle builds an APK from a source checkout, optionally next to a sibling checkout that the
 * build includes by relative path (e.g. `includeBuild("../library")`). The host's Android SDK and
 * a JDK of the pinned major version build it; the Gradle version is pinned by the source's wrapper.
 */
export type ApkBuildOptions = Readonly<{
  directory: string;
  task: string;
  /** Relative to the source: one `.apk` file, or a directory containing exactly one. */
  output: string;
  javaVersion: number;
  /** Further JDK majors the build's Gradle toolchains require (e.g. a library compiled for 17). */
  toolchains: readonly number[];
  sourceDirectory: string;
  siblingDirectory?: string;
  arguments: readonly string[];
}>;

export type ApkBuildDependencies = Readonly<{
  toolchain?: (javaVersion: number, toolchains: readonly number[], signal?: AbortSignal) => Promise<ApkBuildToolchain>;
  run?: ApkBuildRunner;
  /** `aapt2 dump badging` output for an APK. */
  badging?: (aapt2: string, apk: string, signal?: AbortSignal) => Promise<string>;
  log?: (message: string) => void;
  signed?: (apksigner: string, apk: string, signal?: AbortSignal) => Promise<void>;
}>;

const relativePath = (value: string, label: string): string => {
  const path = normalize(value);
  if (!value || isAbsolute(value) || path.startsWith("..")) throw new Error(`${label} must be a relative path inside the checkout`);
  return path;
};
const directoryName = (value: string, label: string): string => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`${label} must be a single directory name`);
  return value;
};

export function validateApkBuild(options: ApkBuildOptions): void {
  if (!/^[A-Za-z0-9:_-]+$/.test(options.task)) throw new Error("task must be a Gradle task path");
  relativePath(options.output, "output");
  for (const major of [options.javaVersion, ...options.toolchains]) {
    if (!Number.isInteger(major) || major < 8) throw new Error("javaVersion and toolchains must be JDK major versions");
  }
  directoryName(options.sourceDirectory, "sourceDirectory");
  if (options.siblingDirectory !== undefined) directoryName(options.siblingDirectory, "siblingDirectory");
  if (options.siblingDirectory === options.sourceDirectory) throw new Error("siblingDirectory must differ from sourceDirectory");
  for (const argument of options.arguments) if (!argument.startsWith("-") || /^(?:-I|-p|-c|--(?:init-script|project-dir|settings-file|configuration-cache|include-build|gradle-user-home)|-[DP]org.gradle.java.(?:installations|home))/.test(argument)) throw new Error("arguments may only add Gradle options; the task is configured separately");
}


async function findApk(checkout: string, output: string): Promise<string> {
  const path = join(checkout, output);
  const info = await stat(path).catch(() => undefined);
  if (info?.isFile() && path.endsWith(".apk")) return path;
  if (!info?.isDirectory()) throw new Error(`Build output ${output} does not exist`);
  const apks = (await readdir(path)).filter((name) => name.endsWith(".apk"));
  if (apks.length !== 1) throw new Error(`Build output ${output} must contain exactly one APK, found ${apks.length}`);
  return join(path, apks[0]!);
}

type Observations = Readonly<{ gradle: string; jvm: { version: string; vendor: string }; javaCompile: readonly unknown[] }>;
type BuildRecord = Readonly<{ version: 2; key: string; apk: AndroidApk; source: SourceIdentity; sibling?: SourceIdentity; observations: Observations; tools: { java: string; toolchains: readonly string[]; fingerprint: string } }>;
async function cachedBuild(path: string, key: string): Promise<BuildRecord | undefined> {
  try {
    const record = JSON.parse(await readFile(join(path, "build.json"), "utf8")) as BuildRecord;
    if (record?.version === 2 && record.key === key && record.observations?.gradle && record.tools?.fingerprint && record.apk?.path === join(path, "application.apk") && await sha256(record.apk.path) === record.apk.sha256) return record;
  } catch (error) { if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return undefined;
}
async function observations(path: string): Promise<Observations> {
  const runtime = JSON.parse(await readFile(join(path, "runtime.json"), "utf8")) as Omit<Observations, "javaCompile">;
  if (!runtime.gradle || !runtime.jvm?.version || !runtime.jvm.vendor) throw new Error("Gradle did not report its runtime tools");
  const javaCompile = await Promise.all((await readdir(path)).filter((name) => name !== "runtime.json" && name.endsWith(".json")).sort().map(async (name) => JSON.parse(await readFile(join(path, name), "utf8"))));
  return { ...runtime, javaCompile };
}

/** Inputs are constructor values; cache records describe the historical build, never the current PR selection. */
export function apkBuildService(options: ApkBuildOptions, dependencies: ApkBuildDependencies = {}, inputs: Readonly<Record<string, unknown>> = {}): JourneyService {
  options = structuredClone(options);
  validateApkBuild(options);
  const { toolchain = (major: number, versions: readonly number[], signal?: AbortSignal) => hostToolchain(major, versions, process.env, signal), run = runGradle, log = console.log } = dependencies;
  const badging = dependencies.badging ?? ((aapt2: string, apk: string, signal?: AbortSignal) => capture(aapt2, ["dump", "badging", apk], signal));
  const signed = dependencies.signed ?? (async (tool: string, path: string, signal?: AbortSignal) => { await capture(tool, ["verify", path], signal); });
  return Object.freeze({
    name: "android-apk-build",
    async start({ signal }) {
      signal?.throwIfAborted();
      const source = inputs.source as SourceCheckout | undefined;
      const siblingCheckout = inputs.sibling as SourceCheckout | undefined;
      if (!source?.directory) throw new Error("Missing source checkout");
      if (!!siblingCheckout !== (options.siblingDirectory !== undefined)) throw new Error("A sibling checkout and siblingDirectory must be configured together");
      const identity = sourceIdentity(source.identity);
      const sibling = siblingCheckout ? sourceIdentity(siblingCheckout.identity) : undefined;
      const tools = await toolchain(options.javaVersion, options.toolchains, signal);
      signal?.throwIfAborted();
      const key = createHash("sha256").update(JSON.stringify({
        version: 2, source: [identity.repository, identity.sourceSha], sibling: sibling && [sibling.repository, sibling.sourceSha],
        layout: [options.sourceDirectory, options.siblingDirectory], task: options.task, output: options.output,
        tools: tools.fingerprint, java: tools.javaVersion, toolchains: tools.installations.map((jdk) => jdk.version), arguments: options.arguments
      })).digest("hex");
      const cacheRoot = resolve(options.directory, "artifacts-v2", key);
      const index = resolve(options.directory, "cache-v2", key + ".json");
      const generation = await readJsonRecord<{ generation: string }>(index);
      if (generation && !/^[a-f0-9-]{36}$/.test(generation.generation)) throw new Error("Invalid APK cache generation");
      const cached = await cachedBuild(generation ? join(cacheRoot, generation.generation) : cacheRoot, key);
      const result = (record: BuildRecord, reused: boolean) => {
        const selection = sourceIdentity({ ...identity, version: record.apk.versionName });
        return startedService({ apk: record.apk, identity: selection }, {
          selection: { source: selection, ...(sibling ? { sibling } : {}) }, cache: { reused, key },
          build: { source: record.source, ...(record.sibling ? { sibling: record.sibling } : {}), task: options.task,
            tools: { configured: { javaMajor: options.javaVersion, toolchainMajors: options.toolchains }, resolved: record.tools,
              observed: record.observations, scope: "Gradle runtime and executed JavaCompile tasks; other task toolchains are unknown" },
            apk: { package: record.apk.package, versionCode: record.apk.versionCode, versionName: record.apk.versionName, sha256: record.apk.sha256 } }
        });
      };
      if (cached) { await signed(tools.apksigner, cached.apk.path, signal); log(`[apk-build] Reuse ${cached.apk.package} ${cached.apk.versionName}`); return result(cached, true); }
      // A damaged generation never requires deleting an APK held by another execution.
      const nextGeneration = randomUUID();
      const cache = join(cacheRoot, nextGeneration);
      const work = resolve(options.directory, "work", randomUUID());
      await mkdir(work, { recursive: true });
      const copy = (from: string, name: string) => cp(from, join(work, name), { recursive: true, verbatimSymlinks: true, filter: (path) => basename(path) !== ".git" });
      await copy(source.directory, options.sourceDirectory);
      if (siblingCheckout) await copy(siblingCheckout.directory, options.siblingDirectory!);
      const checkout = join(work, options.sourceDirectory);
      const observationPath = join(work, "observations");
      const initPath = join(work, "observations.gradle");
      await mkdir(observationPath); await writeFile(initPath, gradleObservations);
      const env: NodeJS.ProcessEnv = { ...process.env, JAVA_HOME: tools.javaHome, ANDROID_HOME: tools.sdk, ANDROID_SDK_ROOT: tools.sdk,
        JOURNEY_GRADLE_OBSERVATIONS: observationPath, PATH: [join(tools.javaHome, "bin"), process.env.PATH ?? ""].join(delimiter) };
      const logPath = join(work, "gradle.log");
      log(`[apk-build] ${options.task} for ${identity.sourceSha.slice(0, 12)}; log: ${logPath}`);
      const toolchainArguments = [
        `-Porg.gradle.java.installations.paths=${[tools.javaHome, ...tools.installations.map((jdk) => jdk.home)].join(",")}`,
        "-Porg.gradle.java.installations.auto-detect=false", "-Porg.gradle.java.installations.auto-download=false"
      ];
      await run(join(checkout, "gradlew"), ["--no-daemon", "--console=plain", "--no-configuration-cache", "--init-script", initPath, ...toolchainArguments, ...options.arguments, options.task], { cwd: checkout, env, logPath, signal });
      signal?.throwIfAborted();
      const path = await findApk(checkout, options.output);
      await signed(tools.apksigner, path, signal);
      const apk: AndroidApk = { path: join(cache, "application.apk"), sha256: await sha256(path), ...parseBadging(await badging(tools.aapt2, path, signal)) };
      const observed = await observations(observationPath);
      const record: BuildRecord = { version: 2, key, apk, source: identity, ...(sibling ? { sibling } : {}), observations: observed,
        tools: { java: tools.javaVersion, toolchains: tools.installations.map((jdk) => jdk.version), fingerprint: tools.fingerprint } };
      const publication = join(work, "publication");
      await mkdir(publication); await cp(path, join(publication, "application.apk"));
      await writeFile(join(publication, "build.json"), JSON.stringify(record, null, 2) + "\n");
      await mkdir(resolve(cache, ".."), { recursive: true });
      await rename(publication, cache);
      const published = await cachedBuild(cache, key);
      if (!published) throw new Error("APK artifact publication failed integrity validation; existing cache was preserved");
      await writeJsonRecord(index, { generation: nextGeneration });
      // Keep the build log and observations; remove copied source trees only after immutable publication.
      await rm(checkout, { recursive: true, force: true });
      if (options.siblingDirectory) await rm(join(work, options.siblingDirectory), { recursive: true, force: true });
      return result(published, false);
    }
  });
}
