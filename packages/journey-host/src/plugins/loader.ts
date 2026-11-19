import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AdapterDependencies, AdapterPlugin, JourneyMeshPlugin, JourneyPluginContext, JourneyPluginKind, PluginOfKind
} from "@openuji/journey-plugin";
import { interpolate, type Environment } from "../config/load.js";
import type { ComponentConfig } from "../config/schema.js";

/** What `create()` returns for each plugin kind. */
export type ComponentOf<K extends JourneyPluginKind> = Awaited<ReturnType<PluginOfKind<K>["create"]>>;
export type LoadedPlugin<K extends JourneyPluginKind> = Readonly<{
  plugin: PluginOfKind<K>;
  create(dependencies?: AdapterDependencies): Promise<ComponentOf<K>>;
}>;
export type PluginLoader = <K extends JourneyPluginKind>(
  kind: K, component: ComponentConfig, label: string, context: JourneyPluginContext,
  /** Checked before options are parsed, e.g. driver and observer compatibility with an adapter. */
  compatible?: (plugin: PluginOfKind<K>) => void
) => Promise<LoadedPlugin<K>>;

const kinds: readonly JourneyPluginKind[] = ["model", "adapter", "driver", "observer", "profile", "environment", "service"];
const fn = (value: unknown, key: string) => typeof (value as Record<string, unknown> | null)?.[key] === "function";

/** Runtime shape checks at the dynamic-import boundary, so the rest of the host can rely on the types. */
const shapes: Record<JourneyPluginKind, (value: unknown) => boolean> = {
  model: (value) => fn(value, "compile") && fn(value, "resolveOperation"),
  adapter: (value) => fn(value, "createExecution"),
  driver: (value) => value !== null && typeof value === "object",
  observer: (value) => (value as { observer?: unknown } | null)?.observer !== undefined && fn(value, "output"),
  profile: (value) => typeof (value as { id?: unknown } | null)?.id === "string" && !!(value as { id: string }).id,
  environment: (value) => value !== null && typeof value === "object",
  service: (value) => fn(value, "up")
};

/**
 * The single way components are loaded: resolve `use`, import once per module, check the kind,
 * interpolate options, parse them into settings, and create the component on demand.
 */
export function pluginLoader(configPath: string, env: Environment): PluginLoader {
  const modules = new Map<string, Promise<JourneyMeshPlugin>>();
  const importPlugin = (reference: string): Promise<JourneyMeshPlugin> => {
    const modulePath = reference.startsWith(".") || reference.startsWith("/")
      ? resolve(dirname(configPath), reference)
      : createRequire(configPath).resolve(reference);
    let pending = modules.get(modulePath);
    if (!pending) {
      pending = import(pathToFileURL(modulePath).href).then((module: { journeyMeshPlugin?: JourneyMeshPlugin }) => {
        const plugin = module.journeyMeshPlugin;
        if (!plugin || !kinds.includes(plugin.kind) || typeof plugin.parse !== "function" || typeof plugin.create !== "function") {
          throw new Error(`Plugin ${reference} must export journeyMeshPlugin with a known kind, parse and create`);
        }
        return plugin;
      });
      modules.set(modulePath, pending);
    }
    return pending;
  };
  async function load<K extends JourneyPluginKind>(
    kind: K, component: ComponentConfig, label: string, context: JourneyPluginContext, compatible?: (plugin: PluginOfKind<K>) => void
  ): Promise<LoadedPlugin<K>> {
    const plugin = await importPlugin(interpolate(component.use, env, `${label}.use`));
    if (plugin.kind !== kind) throw new Error(`${label} requires a ${kind} plugin, received ${plugin.kind}`);
    const typed = plugin as PluginOfKind<K>;
    compatible?.(typed);
    const options = interpolate(component.options, env, `${label}.options`);
    let settings: unknown;
    try { settings = await plugin.parse({ ...options }, context); }
    catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : "invalid options"}`); }
    return {
      plugin: typed,
      async create(dependencies: AdapterDependencies = { observers: [] }): Promise<ComponentOf<K>> {
        const created: unknown = await (plugin as AdapterPlugin).create(settings, context, dependencies);
        if (!shapes[kind](created)) throw new Error(`${label} must create a ${kind}`);
        return created as ComponentOf<K>;
      }
    };
  }
  return load;
}
