import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isMap, isScalar, parseDocument } from "yaml";
import { optionsObject, requiredString } from "./plugin.js";

export type ComponentConfig = { use: string; options?: Record<string, unknown> };
export type AdapterConfig = ComponentConfig & { driver?: ComponentConfig; observers?: ComponentConfig[] };
export type JourneyItemConfig = { id: string; source: string; select: string; adapter: string };
export type TestProfileConfig = { id: string; journeys: Record<string, string> };
export type JourneyTestDefinition = {
  journeys: JourneyItemConfig[];
  profiles: TestProfileConfig[];
  environment?: ComponentConfig;
  timeoutMs?: number | string;
};
export type JourneyTestConfig = {
  version: 1;
  envFiles?: (string | { path?: string; env?: string; optional?: boolean })[];
  model: ComponentConfig;
  adapters: Record<string, AdapterConfig>;
  profiles: Record<string, ComponentConfig>;
  tests: Record<string, JourneyTestDefinition>;
  outputDir?: string;
};
export class JourneyConfigError extends Error {
  override name = "JourneyConfigError";
  readonly testId?: string;
  readonly testIds: readonly string[];

  constructor(message: string, context: { testId?: string; testIds?: readonly string[] } = {}) {
    super(message);
    this.testId = context.testId;
    this.testIds = Object.freeze([...(context.testIds ?? [])]);
  }
}
export type LoadedJourneyConfig = {
  config: JourneyTestConfig;
  path: string;
  env: Readonly<Record<string, string | undefined>>;
  testOrder: readonly string[];
};

export async function loadJourneyTestConfig(path: string, environment: Record<string, string | undefined> = process.env): Promise<LoadedJourneyConfig> {
  const absolutePath = resolve(path);
  try {
    const document = parseDocument(await readFile(absolutePath, "utf8"), { uniqueKeys: true });
    if (document.errors.length) throw new Error(document.errors.map((error) => error.message).join("\n"));
    const raw = optionsObject(document.toJS({ maxAliasCount: 1000 }), "configuration");
    if (raw.version !== 1) throw new Error("Configuration version must be 1");
    optionsObject(raw.model, "model");
    optionsObject(raw.adapters, "adapters");
    optionsObject(raw.profiles, "profiles");
    const tests = optionsObject(raw.tests, "tests");
    if (!Object.keys(tests).length) throw new Error("At least one test is required");
    const testMap = document.get("tests", true);
    if (!isMap(testMap)) throw new Error("tests must be a mapping");
    const testOrder = testMap.items.map((pair) => requiredString(isScalar(pair.key) ? pair.key.value : undefined, "test ID"));
    const config = raw as unknown as JourneyTestConfig;
    const fileEnv: Record<string, string> = {};
    if (config.envFiles !== undefined && !Array.isArray(config.envFiles)) throw new Error("envFiles must be an array");
    for (const entry of config.envFiles ?? []) {
      const item = typeof entry === "string" ? { path: entry } : optionsObject(entry, "envFiles entry");
      const name = item.env ? environment[requiredString(item.env, "envFiles.env")] : requiredString(item.path, "envFiles.path");
      if (!name && item.optional) continue;
      if (!name) throw new Error(`Missing environment-file variable ${item.env}`);
      let source: string;
      try { source = await readFile(resolve(dirname(absolutePath), name), "utf8"); }
      catch (error) {
        if (item.optional && !item.env && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const line of source.split(/\r?\n/)) {
        const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        const value = match[2].trim();
        fileEnv[match[1]] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value.replace(/\s+#.*$/, "");
      }
    }
    return { config, testOrder: Object.freeze(testOrder), path: absolutePath, env: Object.freeze({ ...fileEnv, ...Object.fromEntries(Object.entries(environment).filter(([, value]) => value !== undefined)) }) };
  } catch (error) { throw new JourneyConfigError(error instanceof Error ? error.message : "Could not load configuration"); }
}

/** Expand only selected components, so an unrelated device does not require credentials. */
export function interpolate<T>(value: T, env: LoadedJourneyConfig["env"], location: string): T {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_match, name: string, fallback: string | undefined) => {
      const replacement = env[name] || fallback;
      if (replacement === undefined) throw new JourneyConfigError(`Missing environment variable ${name} at ${location}`);
      return replacement;
    }) as T;
  }
  if (Array.isArray(value)) return value.map((item, index) => interpolate(item, env, `${location}[${index}]`)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, env, `${location}.${key}`)])) as T;
  return value;
}
