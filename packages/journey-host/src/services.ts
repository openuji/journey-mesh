import { immutableSnapshot } from "@openuji/journey-core";
import { dirname, resolve } from "node:path";
import { serviceFilesPrefix } from "@openuji/journey-run-record";
import { fileEvidenceStore } from "@openuji/journey-run-record/node";
import type { JourneyArtifactStore, JourneyService, ServicePlugin } from "@openuji/journey-plugin";
import { sourceIdentityContract } from "@openuji/journey-plugin";
import { loadSuiteConfig, JourneyConfigError, type LoadedSuiteConfig } from "./config/load.js";
import type { ServiceConfig } from "./config/schema.js";
import { pluginContext } from "./plugins/context.js";
import { pluginLoader, type PluginLoader } from "./plugins/loader.js";

export type LoadedService = Readonly<{ key: string; service: JourneyService; artifacts: JourneyArtifactStore;
  inputs?: ServiceConfig["inputs"]; outputs?: ServicePlugin["outputs"] }>;

export async function startService(entry: LoadedService, values: Map<string, Readonly<Record<string, unknown>>>, signal?: AbortSignal): Promise<void> {
  const inputs = Object.fromEntries(Object.entries(entry.inputs ?? {}).map(([key, ref]) => {
    const outputs = values.get(ref.service);
    if (!outputs || !Object.hasOwn(outputs, ref.output)) throw new Error(`Missing service output ${ref.service}.${ref.output}`);
    return [key, outputs[ref.output]];
  }));
  const result = await entry.service.up({ signal, inputs: Object.freeze(inputs) });
  for (const name of Object.keys(entry.outputs ?? {})) if (!result || !Object.hasOwn(result, name)) throw new Error(`services.${entry.key} did not produce output ${name}`);
  values.set(entry.key, immutableSnapshot({ ...result }));
}

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
export async function loadServices(loaded: LoadedSuiteConfig, load: PluginLoader, keys: readonly string[], outputDir: string, checkTarget = false): Promise<LoadedService[]> {
  const result: LoadedService[] = [];
  for (const key of keys) {
    const artifacts = fileEvidenceStore(outputDir, serviceFilesPrefix(key));
    const context = pluginContext({ configPath: loaded.path, env: loaded.env, testId: "service", artifacts });
    const definition = loaded.config.services[key];
    const component = await load("service", definition, `services.${key}`, context);
    const expected = component.plugin.inputs ?? {};
    for (const name of new Set([...Object.keys(expected), ...Object.keys(definition.inputs)])) {
      const ref = definition.inputs[name];
      const provided = ref && result.find((entry) => entry.key === ref.service)?.outputs?.[ref.output];
      if (!expected[name] || !provided || expected[name].id !== provided.id) throw new JourneyConfigError(`Invalid or incompatible service input services.${key}.inputs.${name}`);
    }
    result.push({ key, service: await component.create(), artifacts, inputs: definition.inputs, outputs: component.plugin.outputs });
  }
  if (checkTarget && loaded.config.target) {
    const target = loaded.config.target;
    const output = result.find((entry) => entry.key === target.service)?.outputs?.[target.output];
    if (output?.id !== sourceIdentityContract.id) throw new JourneyConfigError("target must reference a source-identity output of a selected service");
  }
  return result;
}

export function outputDirectory(loaded: LoadedSuiteConfig, override?: string): string {
  return override ?? resolve(dirname(loaded.path), loaded.config.outputDir ?? "test-results");
}

export type ServicesOptions = { service?: string; env?: Record<string, string | undefined>; outputDir?: string };

/**
 * `options.service` selects the service and its dependency closure. Omitted, all services run.
 * Down runs in reverse dependency order.
 * `up` stops at the first failure; `down` is best-effort across every entry.
 */
export async function runConfiguredServices(path: string, action: "up" | "down", options: ServicesOptions = {}): Promise<void> {
  const loaded = await loadSuiteConfig(path, options.env);
  const services = loaded.config.services;
  if (options.service !== undefined && !Object.hasOwn(services, options.service)) throw new JourneyConfigError(`Unknown service ${options.service}`);
  const composed = Object.values(services).some((entry) => Object.keys(entry.inputs).length > 0);
  const keys = options.service && !composed ? [options.service] : orderServices(services, options.service === undefined ? undefined : [options.service]);
  const loadedServices = await loadServices(loaded, pluginLoader(loaded.path, loaded.env), keys, outputDirectory(loaded, options.outputDir));
  if (action === "up") {
    const values = new Map<string, Readonly<Record<string, unknown>>>();
    const attempted: LoadedService[] = [];
    try {
      for (const entry of loadedServices) {
        attempted.push(entry);
        try { await startService(entry, values); } catch (cause) { throw new Error(`services.${entry.key}: ${cause instanceof Error ? cause.message : "startup failed"}`, { cause }); }
      }
    } catch (error) {
      const failures: unknown[] = [error];
      for (const entry of composed ? attempted.reverse() : []) try { await entry.service.down?.(); } catch (cleanup) { failures.push(cleanup); }
      if (!composed) throw error;
      throw new AggregateError(failures, `Service startup failed: ${error instanceof Error ? error.message : "unknown failure"}`);
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
