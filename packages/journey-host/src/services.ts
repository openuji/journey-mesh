import { dirname, resolve } from "node:path";
import { fileArtifactStore } from "@openuji/journey-reporter";
import type { JourneyArtifactStore, JourneyService } from "@openuji/journey-plugin";
import { loadSuiteConfig, JourneyConfigError, type LoadedSuiteConfig } from "./config/load.js";
import type { ServiceConfig } from "./config/schema.js";
import { pluginContext } from "./plugins/context.js";
import { pluginLoader, type PluginLoader } from "./plugins/loader.js";

export type LoadedService = Readonly<{ key: string; service: JourneyService; artifacts: JourneyArtifactStore }>;

/** `keys` and their dependencies, dependencies first; every service when `keys` is omitted. */
export function orderServices(services: Readonly<Record<string, ServiceConfig>>, keys?: readonly string[]): string[] {
  const order: string[] = [];
  const visiting = new Set<string>();
  const visit = (key: string): void => {
    if (order.includes(key)) return;
    if (!Object.hasOwn(services, key)) throw new JourneyConfigError(`Unknown service ${key}`);
    if (visiting.has(key)) throw new JourneyConfigError(`Circular services.dependsOn involving ${key}`);
    visiting.add(key);
    services[key].dependsOn.forEach(visit);
    visiting.delete(key);
    order.push(key);
  };
  (keys ?? Object.keys(services)).forEach(visit);
  return order;
}

/** Service artifacts (e.g. the identity of a provisioned stack) are written below `<outputDir>/services/<key>/`. */
export async function loadServices(loaded: LoadedSuiteConfig, load: PluginLoader, keys: readonly string[], outputDir: string): Promise<LoadedService[]> {
  const result: LoadedService[] = [];
  for (const key of keys) {
    const artifacts = fileArtifactStore(outputDir, `services/${key}`);
    const context = pluginContext({ configPath: loaded.path, env: loaded.env, testId: "service", artifacts });
    const service = await (await load("service", loaded.config.services[key], `services.${key}`, context)).create();
    result.push({ key, service, artifacts });
  }
  return result;
}

export function outputDirectory(loaded: LoadedSuiteConfig, override?: string): string {
  return override ?? resolve(dirname(loaded.path), loaded.config.outputDir ?? "test-results");
}

export type ServicesOptions = { service?: string; env?: Record<string, string | undefined>; outputDir?: string };

/**
 * `options.service` selects exactly that one entry, without its `dependsOn` (a service that needs another
 * already up fails fast). Omitted, every entry runs in `dependsOn` order, reversed for `down`.
 * `up` stops at the first failure; `down` is best-effort across every entry.
 */
export async function runConfiguredServices(path: string, action: "up" | "down", options: ServicesOptions = {}): Promise<void> {
  const loaded = await loadSuiteConfig(path, options.env);
  const services = loaded.config.services;
  if (options.service !== undefined && !Object.hasOwn(services, options.service)) throw new JourneyConfigError(`Unknown service ${options.service}`);
  const keys = options.service !== undefined ? [options.service] : orderServices(services);
  const loadedServices = await loadServices(loaded, pluginLoader(loaded.path, loaded.env), keys, outputDirectory(loaded, options.outputDir));
  if (action === "up") {
    for (const { key, service } of loadedServices) {
      try { await service.up(); }
      catch (error) { throw new Error(`services.${key}: ${error instanceof Error ? error.message : "failed to start"}`); }
    }
    return;
  }
  const errors: string[] = [];
  for (const { key, service } of [...loadedServices].reverse()) {
    try { await service.down?.(); }
    catch (error) { errors.push(`services.${key}: ${error instanceof Error ? error.message : "failed to stop"}`); }
  }
  if (errors.length) throw new Error(errors.join("\n"));
}
