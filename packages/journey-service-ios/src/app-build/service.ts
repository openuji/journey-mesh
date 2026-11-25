import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { startedService, sourceIdentity, type JourneyService, type SourceCheckout, type SourceIdentity } from "@openuji/journey-plugin";
import { readJsonRecord, writeJsonRecord } from "@openuji/journey-plugin/node";
import type { IosAppBundle } from "@openuji/journey-platform-ios";
import {
  bundleSha256, hostXcodeToolchain, iosFileSha256, readBundleInfoPlist, runXcodebuild,
  type AppBundleInfo, type XcodeBuildRunner, type XcodeBuildToolchain
} from "@openuji/journey-toolkit-ios";

export type IosAppBuildOptions = Readonly<{
  directory: string;
  scheme: string;
  project?: string;
  workspace?: string;
  configuration: string;
  destination?: string;
  /** Relative to DerivedData (or checkout): one `.app` directory, or a directory containing exactly one `.app`. */
  output: string;
  xcodeVersion?: string;
  sourceDirectory: string;
  siblingDirectory?: string;
  /** Relative target path inside the copied checkout → resolved host fixture path. */
  files?: Readonly<Record<string, string>>;
  arguments: readonly string[];
}>;

export type IosAppBuildDependencies = Readonly<{
  toolchain?: (xcodeVersion: string | undefined, signal?: AbortSignal) => Promise<XcodeBuildToolchain>;
  run?: XcodeBuildRunner;
  inspectPlist?: (appPath: string, signal?: AbortSignal) => Promise<AppBundleInfo>;
  log?: (message: string) => void;
}>;

const relativePath = (value: string, label: string): string => {
  const path = normalize(value);
  if (!value || isAbsolute(value) || path === "." || path === ".." || path.startsWith("../") || path.startsWith("..\\")) {
    throw new Error(`${label} must be a relative path inside the build tree`);
  }
  return path;
};

const directoryName = (value: string, label: string): string => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`${label} must be a single directory name`);
  return value;
};

export function validateIosAppBuild(options: IosAppBuildOptions): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(options.scheme)) throw new Error("scheme must be a valid Xcode scheme name");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.configuration)) throw new Error("configuration must be a valid Xcode build configuration");
  if (options.project !== undefined && options.workspace !== undefined) {
    throw new Error("Choose at most one of project or workspace");
  }
  if (options.project !== undefined) relativePath(options.project, "project");
  if (options.workspace !== undefined) relativePath(options.workspace, "workspace");
  relativePath(options.output, "output");
  directoryName(options.sourceDirectory, "sourceDirectory");
  if (options.siblingDirectory !== undefined) directoryName(options.siblingDirectory, "siblingDirectory");
  if (options.siblingDirectory === options.sourceDirectory) throw new Error("siblingDirectory must differ from sourceDirectory");
  for (const target of Object.keys(options.files ?? {})) relativePath(target, `files.${target}`);
  for (const argument of options.arguments) {
    if (/^-(?:derivedDataPath|clonedSourcePackagesDirPath|scmProvider|project|workspace|scheme|resultBundlePath|destination|sdk|configuration)\b/.test(argument)) {
      throw new Error("arguments may not override managed xcodebuild path or target options");
    }
  }
}

async function findAppBundle(derivedData: string, checkout: string, output: string): Promise<string> {
  for (const base of [derivedData, checkout]) {
    const candidate = join(base, output);
    const info = await stat(candidate).catch(() => undefined);
    if (!info?.isDirectory()) continue;
    if (candidate.endsWith(".app")) return candidate;
    const apps = (await readdir(candidate)).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1) throw new Error(`Build output ${output} must contain exactly one .app bundle, found ${apps.length}`);
    return join(candidate, apps[0]!);
  }
  throw new Error(`Build output ${output} does not exist`);
}

type BuildRecord = Readonly<{
  version: 1;
  key: string;
  app: IosAppBundle;
  source: SourceIdentity;
  sibling?: SourceIdentity;
  tools: { xcodeVersion: string; xcodeBuild: string; swiftVersion: string; fingerprint: string };
}>;

async function cachedBuild(path: string, key: string): Promise<BuildRecord | undefined> {
  try {
    const record = JSON.parse(await readFile(join(path, "build.json"), "utf8")) as BuildRecord;
    if (
      record?.version === 1
      && record.key === key
      && record.tools?.fingerprint
      && record.app?.path === join(path, "Application.app")
      && await bundleSha256(record.app.path) === record.app.sha256
    ) {
      return record;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return undefined;
}

/** Inputs are constructor values; cache records retain historical build identity separately from current PR selection. */
export function iosAppBuildService(
  options: IosAppBuildOptions,
  dependencies: IosAppBuildDependencies = {},
  inputs: Readonly<Record<string, unknown>> = {}
): JourneyService {
  options = structuredClone(options);
  validateIosAppBuild(options);
  const toolchain = dependencies.toolchain ?? ((version, signal) => hostXcodeToolchain(version, process.env, signal));
  const run = dependencies.run ?? runXcodebuild;
  const inspectPlist = dependencies.inspectPlist ?? ((appPath, signal) => readBundleInfoPlist(appPath, { signal }));
  const log = dependencies.log ?? console.log;

  return Object.freeze({
    name: "ios-app-build",
    async start({ signal }) {
      signal?.throwIfAborted();
      const source = inputs.source as SourceCheckout | undefined;
      const siblingCheckout = inputs.sibling as SourceCheckout | undefined;
      if (!source?.directory) throw new Error("Missing source checkout");
      if (!!siblingCheckout !== (options.siblingDirectory !== undefined)) {
        throw new Error("A sibling checkout and siblingDirectory must be configured together");
      }
      const identity = sourceIdentity(source.identity);
      const sibling = siblingCheckout ? sourceIdentity(siblingCheckout.identity) : undefined;
      const tools = await toolchain(options.xcodeVersion, signal);
      signal?.throwIfAborted();

      const fileDigests = await Promise.all(
        Object.entries(options.files ?? {})
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(async ([target, hostPath]) => [target, await iosFileSha256(hostPath)] as const)
      );

      const key = createHash("sha256").update(JSON.stringify({
        version: 2,
        source: [identity.repository, identity.sourceSha],
        sibling: sibling && [sibling.repository, sibling.sourceSha],
        layout: [options.sourceDirectory, options.siblingDirectory],
        scheme: options.scheme,
        project: options.project,
        workspace: options.workspace,
        configuration: options.configuration,
        destination: options.destination ?? "generic/platform=iOS Simulator",
        output: options.output,
        files: fileDigests,
        tools: tools.fingerprint,
        arguments: options.arguments
      })).digest("hex");

      const cacheRoot = resolve(options.directory, "artifacts-v1", key);
      const index = resolve(options.directory, "cache-v1", `${key}.json`);
      const generation = await readJsonRecord<{ generation: string }>(index);
      if (generation && !/^[a-f0-9-]{36}$/.test(generation.generation)) throw new Error("Invalid iOS app cache generation");
      const cached = await cachedBuild(generation ? join(cacheRoot, generation.generation) : cacheRoot, key);

      const result = (record: BuildRecord, reused: boolean) => {
        const selection = sourceIdentity({ ...identity, version: record.app.bundleShortVersionString });
        return startedService({ app: record.app, identity: selection }, {
          selection: { source: selection, ...(sibling ? { sibling } : {}) },
          cache: { reused, key },
          build: {
            source: record.source,
            ...(record.sibling ? { sibling: record.sibling } : {}),
            scheme: options.scheme,
            configuration: options.configuration,
            tools: {
              configured: { ...(options.xcodeVersion ? { xcodeVersion: options.xcodeVersion } : {}) },
              resolved: record.tools
            },
            app: {
              bundleId: record.app.bundleId,
              bundleVersion: record.app.bundleVersion,
              bundleShortVersionString: record.app.bundleShortVersionString,
              sha256: record.app.sha256
            }
          }
        });
      };

      if (cached) {
        log(`[ios-app-build] Reuse ${cached.app.bundleId} ${cached.app.bundleShortVersionString}`);
        return result(cached, true);
      }

      const nextGeneration = randomUUID();
      const cache = join(cacheRoot, nextGeneration);
      const work = resolve(options.directory, "work", randomUUID());
      await mkdir(work, { recursive: true });
      const copy = (from: string, name: string) => cp(from, join(work, name), {
        recursive: true,
        verbatimSymlinks: true,
        filter: (path) => basename(path) !== ".git"
      });
      await copy(source.directory, options.sourceDirectory);
      if (siblingCheckout) await copy(siblingCheckout.directory, options.siblingDirectory!);
      const checkout = join(work, options.sourceDirectory);

      for (const [target, hostPath] of Object.entries(options.files ?? {})) {
        const destination = join(checkout, target);
        await mkdir(dirname(destination), { recursive: true });
        await cp(hostPath, destination);
      }

      const derivedData = join(work, "DerivedData");
      const sourcePackages = resolve(options.directory, "source-packages");
      await mkdir(sourcePackages, { recursive: true });
      await mkdir(derivedData, { recursive: true });
      await symlink(sourcePackages, join(derivedData, "SourcePackages"));
      const logPath = join(work, "xcodebuild.log");
      const env: NodeJS.ProcessEnv = { ...process.env, DEVELOPER_DIR: tools.developerDir };
      const buildArgs = [
        "build",
        "-scheme", options.scheme,
        ...(options.project ? ["-project", options.project] : []),
        ...(options.workspace ? ["-workspace", options.workspace] : []),
        "-configuration", options.configuration,
        "-sdk", "iphonesimulator",
        "-destination", options.destination ?? "generic/platform=iOS Simulator",
        "-derivedDataPath", derivedData,
        "-scmProvider", "system",
        ...options.arguments
      ];
      log(`[ios-app-build] ${options.scheme} (${options.configuration}) for ${identity.sourceSha.slice(0, 12)}; log: ${logPath}`);
      await run("xcodebuild", buildArgs, { cwd: checkout, env, logPath, signal });
      signal?.throwIfAborted();

      const builtAppPath = await findAppBundle(derivedData, checkout, options.output);
      const plistInfo = await inspectPlist(builtAppPath, signal);
      const sha256 = await bundleSha256(builtAppPath);
      const app: IosAppBundle = {
        path: join(cache, "Application.app"),
        sha256,
        ...plistInfo
      };
      const record: BuildRecord = {
        version: 1,
        key,
        app,
        source: identity,
        ...(sibling ? { sibling } : {}),
        tools: {
          xcodeVersion: tools.xcodeVersion,
          xcodeBuild: tools.xcodeBuild,
          swiftVersion: tools.swiftVersion,
          fingerprint: tools.fingerprint
        }
      };

      const publication = join(work, "publication");
      await mkdir(publication);
      await cp(builtAppPath, join(publication, "Application.app"), { recursive: true, verbatimSymlinks: true });
      await writeFile(join(publication, "build.json"), JSON.stringify(record, null, 2) + "\n");
      await mkdir(resolve(cache, ".."), { recursive: true });
      await rename(publication, cache);
      const published = await cachedBuild(cache, key);
      if (!published) throw new Error("iOS app artifact publication failed integrity validation; existing cache was preserved");
      await writeJsonRecord(index, { generation: nextGeneration });
      await rm(checkout, { recursive: true, force: true });
      if (options.siblingDirectory) await rm(join(work, options.siblingDirectory), { recursive: true, force: true });
      await unlink(join(derivedData, "SourcePackages")).catch(() => {});
      await rm(derivedData, { recursive: true, force: true });
      return result(published, false);
    }
  });
}
