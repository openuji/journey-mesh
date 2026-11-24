import { positiveNumber, type AdapterPlugin, type DriverPlugin, type JourneyArtifactStore, type JourneyObserverComponent, type ObserverPlugin } from "@openuji/journey-plugin";
import { routedAdapter, type JourneyAdapter, type JourneyEnvironment, type JourneyPlan, type JourneyPlanOperation, type JourneyProfile } from "@openuji/journey-runner";
import { interpolate, type LoadedSuiteConfig } from "./config/load.js";
import type { RuntimeObservable } from "./runtime-observable.js";
import type { TestConfig } from "./config/schema.js";
import { segmentOf, type CompiledTest } from "./compile.js";
import { resolveInputs, type ServiceValues } from "./inputs.js";
import { discoveryInput, undiscoverableAdapter, type SuiteDiscovery } from "./discovery.js";
import { pluginContext } from "./plugins/context.js";
import type { PluginLoader } from "./plugins/loader.js";

/** Everything needed to execute one test. Constructing it allocates no automation resources. */
export type AssembledTest = Readonly<{
  id: string;
  plan: JourneyPlan;
  compiled: CompiledTest;
  adapter: JourneyAdapter;
  profiles: readonly JourneyProfile[];
  environment?: JourneyEnvironment;
  observers: readonly JourneyObserverComponent[];
  /** Listed services and those the test's adapter inputs reference. */
  services: readonly string[];
  artifacts: JourneyArtifactStore;
  timeoutMs: number;
}>;

type AssemblyInput = Readonly<{ loaded: LoadedSuiteConfig; load: PluginLoader; artifacts: JourneyArtifactStore; values: ServiceValues; observations?: RuntimeObservable; discovery?: SuiteDiscovery }>;

const modeOf = (discovery: SuiteDiscovery | undefined) => discovery ? "discovery" as const : "test" as const;

function compatible(adapter: AdapterPlugin, child: DriverPlugin | ObserverPlugin, label: string): void {
  if (child.kind === "driver") {
    if (!adapter.driverContract) throw new Error(`${label} cannot be used because the adapter declares no driver contract`);
    if (child.driverContract?.id !== adapter.driverContract.id) {
      throw new Error(`${label} driver contract ${child.driverContract?.id ?? "unspecified"} is incompatible with ${adapter.driverContract.id}`);
    }
    return;
  }
  if (child.automation?.id !== adapter.automation?.id) {
    throw new Error(`${label} automation ${child.automation?.id ?? "unspecified"} is incompatible with adapter automation ${adapter.automation?.id ?? "unspecified"}`);
  }
}

/** One adapter instance per adapter name and test, with its driver and observers, scoped to its own segments. */
async function assembleAdapters(compiled: CompiledTest, test: TestConfig, { loaded, load, artifacts, values, observations, discovery }: AssemblyInput) {
  const adapters = new Map<string, JourneyAdapter>();
  const observers: JourneyObserverComponent[] = [];

  for (const name of new Set(test.journeys.map((item) => item.adapter))) {
    const operations = compiled.plan.operations.filter((operation) => segmentOf(compiled, operation).adapter === name);
    const definition = loaded.config.adapters[name];
    const context = pluginContext({ configPath: loaded.path, env: loaded.env, testId: test.id, artifacts, operations, aliases: compiled.aliases,
      observations: observations?.publisher(`tests.${test.id}.adapters.${name}`), mode: modeOf(discovery) });
    const adapter = await load("adapter", definition, `adapters.${name}`, context, undefined, Object.keys(definition.inputs));
    const driverLabel = `adapters.${name}.driver`;
    const driver = definition.driver
      ? await (await load("driver", definition.driver, driverLabel, context, (plugin) => compatible(adapter.plugin, plugin, driverLabel))).create()
      : undefined;
    const components: JourneyObserverComponent[] = [];
    // A discovery run measures paths, not the journey: executor observers are not attached.
    if (!discovery) for (const [index, entry] of definition.observers.entries()) {
      const label = `adapters.${name}.observers[${index}]`;
      components.push(await (await load("observer", entry, label, context, (plugin) => compatible(adapter.plugin, plugin, label))).create());
    }
    observers.push(...components);
    const dependencies = { driver, observers: components.map((component) => component.observer), inputs: resolveInputs(definition.inputs, values) };
    adapters.set(name, discovery
      ? await adapter.createDiscovery(dependencies, discoveryInput(test.id, discovery))
      : await adapter.create(dependencies));
  }
  return { adapters, observers };
}

/** Each profile combination becomes one profile that delegates to the profile assigned to an operation's segment. */
async function assembleProfiles(compiled: CompiledTest, test: TestConfig, { loaded, load, artifacts, observations, discovery }: AssemblyInput): Promise<JourneyProfile[]> {
  const context = pluginContext({ configPath: loaded.path, env: loaded.env, testId: test.id, artifacts, operations: compiled.plan.operations, aliases: compiled.aliases,
    observations: observations?.publisher(`tests.${test.id}.profiles`), mode: modeOf(discovery) });
  const instances = new Map<string, JourneyProfile>();
  const profiles: JourneyProfile[] = [];
  for (const combination of test.profiles) {
    const children = new Map<string, JourneyProfile>();
    for (const [itemId, name] of Object.entries(combination.journeys)) {
      if (!instances.has(name)) instances.set(name, await (await load("profile", loaded.config.profiles[name], `profiles.${name}`, context)).create());
      children.set(itemId, instances.get(name)!);
    }
    const childFor = (operation: JourneyPlanOperation) => children.get(segmentOf(compiled, operation).id)!;
    const profile: JourneyProfile = {
      id: combination.id,
      appliesTo: (operation, execution) => {
        const child = childFor(operation);
        return child.appliesTo?.(operation, { ...execution, profile: child }) ?? true;
      },
      async selectInputModality(operation, execution) {
        const child = childFor(operation);
        if (!child.selectInputModality) throw new Error(`Profile ${child.id} cannot select an input modality`);
        return { ...await child.selectInputModality(operation, { ...execution, profile: child }), profileId: combination.id };
      }
    };
    // Modality selection is resource-free; do not discover incompatible combinations after fixtures.
    const preflight = { runId: "preflight", executionId: "preflight", plan: compiled.plan, profile };
    let applicable = true;
    for (const operation of compiled.plan.operations) if (!await profile.appliesTo!(operation, preflight)) { applicable = false; break; }
    if (applicable) for (const operation of compiled.plan.operations) {
      if (operation.kind === "transition" && operation.activation.requiredInputModalityProfiles.length) await profile.selectInputModality!(operation, preflight);
    }
    profiles.push(profile);
  }
  return profiles;
}

export async function assembleTest(test: TestConfig, compiled: CompiledTest, input: AssemblyInput): Promise<AssembledTest> {
  const { loaded, load, artifacts } = input;
  const { adapters, observers } = await assembleAdapters(compiled, test, input);
  const adapter = routedAdapter((operation) => adapters.get(segmentOf(compiled, operation).adapter)!);
  // Unsupported operations fail here, before any fixture or automation is started.
  for (const operation of compiled.plan.operations) adapter.describeOperation?.(operation);
  const profiles = await assembleProfiles(compiled, test, input);
  const context = pluginContext({ configPath: loaded.path, env: loaded.env, testId: test.id, artifacts, operations: compiled.plan.operations, aliases: compiled.aliases,
    observations: input.observations?.publisher(`tests.${test.id}.environment`), mode: modeOf(input.discovery) });
  const environment = test.environment ? await (await load("environment", test.environment, `tests.${test.id}.environment`, context)).create() : undefined;
  return Object.freeze({
    id: test.id, plan: compiled.plan, compiled, adapter, profiles, observers, artifacts,
    services: [...new Set([...test.services, ...test.journeys.flatMap((item) => Object.values(loaded.config.adapters[item.adapter].inputs).map((ref) => ref.service))])],
    ...(environment ? { environment } : {}),
    timeoutMs: positiveNumber(interpolate(test.timeoutMs, loaded.env, `tests.${test.id}.timeoutMs`), 600_000)
  });
}

/** Immutable prepared data; runtime components and evidence stores are never retained here. */
export type PreparedTest = Readonly<{ id: string; config: TestConfig; compiled: CompiledTest; services: readonly string[] }>;

export async function prepareTest(test: TestConfig, compiled: CompiledTest, input: Omit<AssemblyInput, "values">): Promise<PreparedTest> {
  const { loaded, load, artifacts, discovery } = input;
  const mode = modeOf(discovery);
  for (const name of new Set(test.journeys.map((item) => item.adapter))) {
    const operations = compiled.plan.operations.filter((operation) => segmentOf(compiled, operation).adapter === name);
    const context = pluginContext({ configPath: loaded.path, env: loaded.env, testId: test.id, artifacts, operations, aliases: compiled.aliases, mode });
    const definition = loaded.config.adapters[name];
    const adapter = await load("adapter", definition, `adapters.${name}`, context, undefined, Object.keys(definition.inputs));
    // Rejected before any service starts: discovery never runs part of a test unchanged.
    if (discovery && !adapter.plugin.discovery) throw undiscoverableAdapter(test, name, definition.use);
    const driver = definition.driver ? await (await load("driver", definition.driver, `adapters.${name}.driver`, context,
      (plugin) => compatible(adapter.plugin, plugin, `adapters.${name}.driver`))).create() : undefined;
    adapter.validate(driver);
    if (!discovery) for (const [index, observer] of definition.observers.entries()) await load("observer", observer, `adapters.${name}.observers[${index}]`, context,
      (plugin) => compatible(adapter.plugin, plugin, `adapters.${name}.observers[${index}]`));
  }
  await assembleProfiles(compiled, test, { ...input, values: Object.freeze({}) });
  if (test.environment) await load("environment", test.environment, `tests.${test.id}.environment`, pluginContext({ configPath: loaded.path, env: loaded.env, testId: test.id, artifacts, operations: compiled.plan.operations, aliases: compiled.aliases, mode }));
  return Object.freeze({ id: test.id, config: test, compiled, services: Object.freeze([...new Set([...test.services,
    ...test.journeys.flatMap((item) => Object.values(loaded.config.adapters[item.adapter].inputs).map((ref) => ref.service))])]) });
}
