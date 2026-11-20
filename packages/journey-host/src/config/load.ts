import { immutableSnapshot } from "@openuji/journey-core";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isMap, isScalar, parseDocument } from "yaml";
import { optionsObject, requiredString } from "@openuji/journey-plugin";
import { JourneyConfigError } from "./errors.js";
import { parseSuiteConfig, type EnvFileConfig, type SuiteConfig } from "./schema.js";

export { JourneyConfigError };

export type Environment = Readonly<Record<string, string | undefined>>;

export type LoadedSuiteConfig = Readonly<{ config: SuiteConfig; path: string; env: Environment }>;

/** Parse the YAML and its env files once. Component options stay uninterpolated until a component is selected. */
export async function loadSuiteConfig(path: string, environment: Record<string, string | undefined> = process.env, readEnvFiles = true): Promise<LoadedSuiteConfig> {
  const absolutePath = resolve(path);
  try {
    const document = parseDocument(await readFile(absolutePath, "utf8"), { uniqueKeys: true });
    if (document.errors.length) throw new Error(document.errors.map((error) => error.message).join("\n"));
    const raw = optionsObject(document.toJS({ maxAliasCount: 1000 }), "configuration");
    // JavaScript objects reorder numeric-looking keys; YAML declaration order is authoritative.
    const tests = document.get("tests", true);
    const testOrder = isMap(tests) ? tests.items.map((pair) => requiredString(isScalar(pair.key) ? pair.key.value : undefined, "test ID")) : [];
    const config = immutableSnapshot(parseSuiteConfig(raw, testOrder));
    const env = readEnvFiles ? await readEnvironment(config.envFiles, dirname(absolutePath), environment) : immutableSnapshot(environment);
    return Object.freeze({ config, path: absolutePath, env });
  } catch (error) {
    if (error instanceof JourneyConfigError) throw error;
    throw new JourneyConfigError(error instanceof Error ? error.message : "Could not load configuration");
  }
}

/** Process values take precedence over env files; process.env itself is never modified. */
async function readEnvironment(files: readonly EnvFileConfig[], root: string, environment: Record<string, string | undefined>): Promise<Environment> {
  const fileEnv: Record<string, string> = {};
  for (const entry of files) {
    const name = entry.env ? environment[entry.env] : entry.path;
    if (!name && entry.optional) continue;
    if (!name) throw new Error(`Missing environment-file variable ${entry.env}`);
    let source: string;
    try { source = await readFile(resolve(root, name), "utf8"); }
    catch (error) {
      if (entry.optional && !entry.env && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const line of source.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const value = match[2].trim();
      fileEnv[match[1]] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value.replace(/\s+#.*$/, "");
    }
  }
  return Object.freeze({ ...fileEnv, ...Object.fromEntries(Object.entries(environment).filter(([, value]) => value !== undefined)) });
}

/** Expand only selected components, so an unrelated device does not require credentials. */
export function interpolate<T>(value: T, env: Environment, location: string): T {
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
