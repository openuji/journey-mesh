import { immutableSnapshot } from "@openuji/journey-core";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ExecutorDependencies, ExecutorDiscoveryInput, ExecutorPlugin, ServicePlugin, ServiceDependencies, JourneyMeshPlugin, JourneyPluginContext, JourneyPluginKind, PluginOfKind
} from "@openuji/journey-plugin";
import { configContext } from "./context.js";
import { interpolate, type Environment } from "../config/load.js";
import type { ComponentConfig } from "../config/schema.js";

/** What `create()` returns for each plugin kind. */
export type ComponentOf<K extends JourneyPluginKind> = Awaited<ReturnType<PluginOfKind<K>["create"]>>;
export type LoadedPlugin<K extends JourneyPluginKind> = Readonly<{
  plugin: PluginOfKind<K>;
  validate(client?: unknown): void;
  create(dependencies?: ExecutorDependencies | ServiceDependencies, runtimeContext?: JourneyPluginContext): Promise<ComponentOf<K>>;
  /** An executor's discovery mode, for `journey-mesh discover` only; fails for any other plugin. */
  createDiscovery(dependencies: ExecutorDependencies, discovery: ExecutorDiscoveryInput, runtimeContext?: JourneyPluginContext): Promise<ComponentOf<K>>;
  stopConfigured(context?: JourneyPluginContext): Promise<void>;
}>;
export type PluginLoader = <K extends JourneyPluginKind>(
  kind: K, component: ComponentConfig, label: string, context: JourneyPluginContext,
  /** Checked before options are parsed, e.g. client and observer compatibility with an executor. */
  compatible?: (plugin: PluginOfKind<K>) => void, inputNames?: readonly string[], management?: boolean
) => Promise<LoadedPlugin<K>>;

const kinds: readonly JourneyPluginKind[] = ["model", "executor", "client", "executor-observer", "runtime-observer", "profile", "environment", "service"];
/** Plugin kinds renamed by the client/executor terminology; configurations and plugins are not migrated silently. */
const renamedKinds: Readonly<Record<string, JourneyPluginKind>> = { driver: "client", adapter: "executor", observer: "executor-observer" };
const fn = (value: unknown, key: string) => typeof (value as Record<string, unknown> | null)?.[key] === "function";

/** Runtime shape checks at the dynamic-import boundary, so the rest of the host can rely on the types. */
const shapes: Record<JourneyPluginKind, (value: unknown) => boolean> = {
  model: (value) => fn(value, "compile") && fn(value, "resolveOperation"),
  executor: (value) => fn(value, "createSession"),
  client: (value) => value !== null && typeof value === "object",
  "executor-observer": (value) => (value as { observer?: unknown } | null)?.observer !== undefined && fn(value, "output"),
  "runtime-observer": (value) => fn(value, "start") && fn(value, "close"),
  profile: (value) => typeof (value as { id?: unknown } | null)?.id === "string" && !!(value as { id: string }).id,
  environment: (value) => value !== null && typeof value === "object",
  service: (value) => fn(value, "start")
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
        const kind = (plugin as { kind?: unknown } | undefined)?.kind;
        if (typeof kind === "string" && Object.hasOwn(renamedKinds, kind)) {
          throw new Error(`Plugin ${reference}: plugin kind \`${kind}\` was renamed to \`${renamedKinds[kind]}\``);
        }
        if (plugin && Object.hasOwn(plugin, "automation") && !Object.hasOwn(plugin, "observationContract")) {
          throw new Error(`Plugin ${reference}: property \`automation\` was renamed to \`observationContract\``);
        }
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
    kind: K, component: ComponentConfig, label: string, context: JourneyPluginContext, compatible?: (plugin: PluginOfKind<K>) => void, inputNames: readonly string[] = [], management = false
  ): Promise<LoadedPlugin<K>> {
    const plugin = await importPlugin(interpolate(component.use, env, `${label}.use`));
    if (plugin.kind !== kind) throw new Error(`${label} requires a ${kind} plugin, received ${plugin.kind}`);
    const typed = plugin as PluginOfKind<K>;
    compatible?.(typed);
    const options = management ? {} : interpolate(component.options, env, `${label}.options`);
    let settings: unknown;
    try { settings = management ? undefined : immutableSnapshot(await plugin.parse(immutableSnapshot(options), configContext(context), Object.freeze({ names: Object.freeze([...inputNames]) }))); }
    catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : "invalid options"}`); }
    return Object.freeze({
      plugin: typed,
      validate(client?: unknown) {
        if (typed.kind === "executor") (typed as ExecutorPlugin).validateOperations?.(settings, configContext(context), { client });
      },
      async stopConfigured(runtimeContext = context) {
        if (typed.kind === "service") await (typed as ServicePlugin).stopConfigured?.(runtimeContext);
      },
      async create(dependencies: ExecutorDependencies | ServiceDependencies = { observers: [], inputs: Object.freeze({}) }, runtimeContext = context): Promise<ComponentOf<K>> {
        const created: unknown = plugin.kind === "executor"
          ? await plugin.create(settings, runtimeContext, dependencies as ExecutorDependencies)
          : plugin.kind === "service"
            ? await plugin.create(settings, runtimeContext, dependencies as ServiceDependencies)
            : await plugin.create(settings, runtimeContext);
        if (!shapes[kind](created)) throw new Error(`${label} must create a ${kind}`);
        return created as ComponentOf<K>;
      },
      async createDiscovery(dependencies: ExecutorDependencies, discovery: ExecutorDiscoveryInput, runtimeContext = context): Promise<ComponentOf<K>> {
        const mode = typed.kind === "executor" ? (typed as ExecutorPlugin).discovery : undefined;
        if (!mode) throw new Error(`${label} has no discovery mode`);
        const created: unknown = await mode.create(settings, runtimeContext, dependencies, discovery);
        if (!shapes[kind](created)) throw new Error(`${label} discovery mode must create a ${kind}`);
        return created as ComponentOf<K>;
      }
    });
  }
  return load;
}
