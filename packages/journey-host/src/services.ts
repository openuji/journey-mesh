import { immutableSnapshot } from "@openuji/journey-core";
import { dirname, resolve } from "node:path";
import { serviceFilesPrefix } from "@openuji/journey-run-record";
import { fileEvidenceStore } from "@openuji/journey-run-record/node";
import { sourceIdentityContract, type JourneyArtifactStore, type StartedService, type ObservationPublisher } from "@openuji/journey-plugin";
import { loadSuiteConfig, JourneyConfigError, type LoadedSuiteConfig } from "./config/load.js";
import type { ServiceConfig } from "./config/schema.js";
import { resolveInputs, validateInputs, type ServiceValues } from "./inputs.js";
import { pluginContext, preflightArtifacts } from "./plugins/context.js";
import { pluginLoader, type LoadedPlugin, type PluginLoader } from "./plugins/loader.js";

export type LoadedService = Readonly<{ key: string; definition: ServiceConfig; component: LoadedPlugin<"service"> }>;
export type ActiveService = Readonly<{ key: string; lease: StartedService; artifacts: JourneyArtifactStore }>;

export function serviceContext(loaded: LoadedSuiteConfig, key: string, artifacts: JourneyArtifactStore, observations?: ObservationPublisher) {
  return pluginContext({ configPath: loaded.path, env: loaded.env, testId: "service", componentId: `services.${key}`, artifacts, observations });
}

/** Acquires a handle; the caller registers it before inspecting outputs. */
export async function startService(entry: LoadedService, loaded: LoadedSuiteConfig, values: ServiceValues, outputDir: string, signal?: AbortSignal, artifacts = fileEvidenceStore(outputDir, serviceFilesPrefix(entry.key)), observations?: ObservationPublisher): Promise<ActiveService> {
  const service = await entry.component.create({ inputs: resolveInputs(entry.definition.inputs, values) }, serviceContext(loaded, entry.key, artifacts, observations));
  let lease: StartedService;
  try { lease = await service.start({ signal }); } catch (error) { throw new Error(`services.${entry.key}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  return Object.freeze({ key: entry.key, lease, artifacts });
}

export function serviceOutputs(entry: LoadedService, lease: StartedService): Readonly<Record<string, unknown>> {
  if (!lease || typeof lease.release !== "function" || !lease.outputs || typeof lease.outputs !== "object") throw new Error(`services.${entry.key} did not return an acquisition handle`);
  for (const name of Object.keys(entry.component.plugin.outputs ?? {})) if (!Object.hasOwn(lease.outputs, name)) throw new Error(`services.${entry.key} did not produce output ${name}`);
  return immutableSnapshot(lease.outputs);
}

/** Pure dependency ordering. `keys` omitted selects every service. */
export function orderServices(services: Readonly<Record<string, ServiceConfig>>, keys?: readonly string[]): string[] {
  const visit = (key: string, order: readonly string[], visiting: readonly string[]): readonly string[] => {
    if (order.includes(key)) return order;
    if (!Object.hasOwn(services, key)) throw new JourneyConfigError(`Unknown service ${key}`);
    if (visiting.includes(key)) throw new JourneyConfigError(`Circular services.dependsOn involving ${key}`);
    const dependencies = services[key].dependsOn.reduce((result, dependency) => visit(dependency, result, [...visiting, key]), order);
    return [...dependencies, key];
  };
  return [...(keys ?? Object.keys(services)).reduce((order, key) => visit(key, order, []), [] as readonly string[])];
}

export async function loadServices(loaded: LoadedSuiteConfig, load: PluginLoader, keys: readonly string[], checkTarget = false, management = false): Promise<LoadedService[]> {
  const result: LoadedService[] = [];
  for (const key of keys) {
    const definition = loaded.config.services[key];
    const context = serviceContext(loaded, key, preflightArtifacts);
    const component = await load("service", definition, `services.${key}`, context, undefined, Object.keys(definition.inputs), management);
    const contracts = Object.fromEntries(result.map((entry) => [entry.key, entry.component.plugin.outputs ?? {}]));
    validateInputs(component.plugin, definition.inputs, contracts, `services.${key}`);
    result.push(Object.freeze({ key, definition, component }));
  }
  if (checkTarget && loaded.config.target) {
    const target = loaded.config.target;
    if (result.find((entry) => entry.key === target.service)?.component.plugin.outputs?.[target.output]?.id !== sourceIdentityContract.id) throw new JourneyConfigError("target must reference a source-identity output of a selected service");
  }
  return result;
}

export function outputDirectory(loaded: LoadedSuiteConfig, override?: string): string {
  return override ?? resolve(dirname(loaded.path), loaded.config.outputDir ?? "test-results");
}
export type ServicesOptions = { service?: string; env?: Record<string, string | undefined>; outputDir?: string; signal?: AbortSignal };

/** Explicit management always selects the dependency closure; successful up leaves owned resources running. */
export async function runConfiguredServices(path: string, action: "up" | "down", options: ServicesOptions = {}): Promise<void> {
  const loaded = await loadSuiteConfig(path, options.env, action !== "down");
  const keys = orderServices(loaded.config.services, options.service === undefined ? undefined : [options.service]);
  const directory = outputDirectory(loaded, options.outputDir);
  const services = await loadServices(loaded, pluginLoader(loaded.path, loaded.env), keys, false, action === "down");
  if (action === "down") {
    const errors: unknown[] = [];
    for (const entry of [...services].reverse()) try { await entry.component.stopConfigured(); } catch (error) { errors.push(new Error(`services.${entry.key}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })); }
    if (errors.length) throw new AggregateError(errors, `Stopping configured services failed: ${errors.map(String).join("; ")}`);
    return;
  }
  let values: ServiceValues = Object.freeze({});
  let active: readonly ActiveService[] = Object.freeze([]);
  try {
    for (const entry of services) {
      options.signal?.throwIfAborted();
      const acquired = await startService(entry, loaded, values, directory, options.signal);
      active = [...active, acquired];
      values = Object.freeze({ ...values, [entry.key]: serviceOutputs(entry, acquired.lease) });
      options.signal?.throwIfAborted();
    }
  } catch (error) {
    const errors: unknown[] = [error];
    for (const entry of [...active].reverse()) try { await entry.lease.release(); } catch (cleanup) { errors.push(cleanup); }
    throw new AggregateError(errors, `Service startup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
