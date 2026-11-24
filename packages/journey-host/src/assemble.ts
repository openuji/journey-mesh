import { positiveNumber, type ExecutorPlugin, type ClientPlugin, type JourneyArtifactStore, type JourneyObserverComponent, type ExecutorObserverPlugin } from "@openuji/journey-plugin";
import { routedExecutor, type JourneyExecutor, type JourneyEnvironment, type JourneyPlan, type JourneyPlanOperation, type JourneyProfile } from "@openuji/journey-runner";
import { interpolate, type LoadedSuiteConfig } from "./config/load.js";
import type { RuntimeObservable } from "./runtime-observable.js";
import type { TestConfig } from "./config/schema.js";
import { segmentOf, type CompiledTest } from "./compile.js";
import { resolveInputs, type ServiceValues } from "./inputs.js";
import { discoveryInput, undiscoverableExecutor, type SuiteDiscovery } from "./discovery.js";
import { pluginContext } from "./plugins/context.js";
import type { PluginLoader } from "./plugins/loader.js";

/** Everything needed to execute one test. Constructing it allocates no automation resources. */
export type AssembledTest = Readonly<{
  id: string;
  plan: JourneyPlan;
  compiled: CompiledTest;
  executor: JourneyExecutor;
  profiles: readonly JourneyProfile[];
  environment?: JourneyEnvironment;
  observers: readonly JourneyObserverComponent[];
  /** Listed services and those the test's executor inputs reference. */
  services: readonly string[];
  artifacts: JourneyArtifactStore;
  timeoutMs: number;
}>;

type AssemblyInput = Readonly<{ loaded: LoadedSuiteConfig; load: PluginLoader; artifacts: JourneyArtifactStore; values: ServiceValues; observations?: RuntimeObservable; discovery?: SuiteDiscovery }>;

const modeOf = (discovery: SuiteDiscovery | undefined) => discovery ? "discovery" as const : "test" as const;

function compatible(executor: ExecutorPlugin, child: ClientPlugin | ExecutorObserverPlugin, label: string): void {
  if (child.kind === "client") {
    if (!executor.clientContract) throw new Error(`${label} cannot be used because the executor declares no client contract`);
    if (child.clientContract?.id !== executor.clientContract.id) {
      throw new Error(`${label} client contract ${child.clientContract?.id ?? "unspecified"} is incompatible with ${executor.clientContract.id}`);
    }
    return;
  }
  if (child.observationContract?.id !== executor.observationContract?.id) {
    throw new Error(`${label} observation contract ${child.observationContract?.id ?? "unspecified"} is incompatible with executor observation contract ${executor.observationContract?.id ?? "unspecified"}`);
  }
}

/** One executor instance per executor name and test, with its client and observers, scoped to its own segments. */
async function assembleExecutors(compiled: CompiledTest, test: TestConfig, { loaded, load, artifacts, values, observations, discovery }: AssemblyInput) {
  const executors = new Map<string, JourneyExecutor>();
  const observers: JourneyObserverComponent[] = [];

  for (const name of new Set(test.journeys.map((item) => item.executor))) {
    const operations = compiled.plan.operations.filter((operation) => segmentOf(compiled, operation).executor === name);
    const definition = loaded.config.executors[name];
    const context = pluginContext({ configPath: loaded.path, env: loaded.env, testId: test.id, artifacts, operations, aliases: compiled.aliases,
      observations: observations?.publisher(`tests.${test.id}.executors.${name}`), mode: modeOf(discovery) });
    const executor = await load("executor", definition, `executors.${name}`, context, undefined, Object.keys(definition.inputs));
    const clientLabel = `executors.${name}.client`;
    const client = definition.client
      ? await (await load("client", definition.client, clientLabel, context, (plugin) => compatible(executor.plugin, plugin, clientLabel))).create()
      : undefined;
    const components: JourneyObserverComponent[] = [];
    // A discovery run measures paths, not the journey: executor observers are not attached.
    if (!discovery) for (const [index, entry] of definition.observers.entries()) {
      const label = `executors.${name}.observers[${index}]`;
      components.push(await (await load("executor-observer", entry, label, context, (plugin) => compatible(executor.plugin, plugin, label))).create());
    }
    observers.push(...components);
    const dependencies = { client, observers: components.map((component) => component.observer), inputs: resolveInputs(definition.inputs, values) };
    executors.set(name, discovery
      ? await executor.createDiscovery(dependencies, discoveryInput(test.id, discovery))
      : await executor.create(dependencies));
  }
  return { executors, observers };
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
  const { executors, observers } = await assembleExecutors(compiled, test, input);
  const executor = routedExecutor((operation) => executors.get(segmentOf(compiled, operation).executor)!);
  // Unsupported operations fail here, before any fixture or automation is started.
  for (const operation of compiled.plan.operations) executor.describeOperation?.(operation);
  const profiles = await assembleProfiles(compiled, test, input);
  const context = pluginContext({ configPath: loaded.path, env: loaded.env, testId: test.id, artifacts, operations: compiled.plan.operations, aliases: compiled.aliases,
    observations: input.observations?.publisher(`tests.${test.id}.environment`), mode: modeOf(input.discovery) });
  const environment = test.environment ? await (await load("environment", test.environment, `tests.${test.id}.environment`, context)).create() : undefined;
  return Object.freeze({
    id: test.id, plan: compiled.plan, compiled, executor, profiles, observers, artifacts,
    services: [...new Set([...test.services, ...test.journeys.flatMap((item) => Object.values(loaded.config.executors[item.executor].inputs).map((ref) => ref.service))])],
    ...(environment ? { environment } : {}),
    timeoutMs: positiveNumber(interpolate(test.timeoutMs, loaded.env, `tests.${test.id}.timeoutMs`), 600_000)
  });
}

/** Immutable prepared data; runtime components and evidence stores are never retained here. */
export type PreparedTest = Readonly<{ id: string; config: TestConfig; compiled: CompiledTest; services: readonly string[] }>;

export async function prepareTest(test: TestConfig, compiled: CompiledTest, input: Omit<AssemblyInput, "values">): Promise<PreparedTest> {
  const { loaded, load, artifacts, discovery } = input;
  const mode = modeOf(discovery);
  for (const name of new Set(test.journeys.map((item) => item.executor))) {
    const operations = compiled.plan.operations.filter((operation) => segmentOf(compiled, operation).executor === name);
    const context = pluginContext({ configPath: loaded.path, env: loaded.env, testId: test.id, artifacts, operations, aliases: compiled.aliases, mode });
    const definition = loaded.config.executors[name];
    const executor = await load("executor", definition, `executors.${name}`, context, undefined, Object.keys(definition.inputs));
    // Rejected before any service starts: discovery never runs part of a test unchanged.
    if (discovery && !executor.plugin.discovery) throw undiscoverableExecutor(test, name, definition.use);
    const client = definition.client ? await (await load("client", definition.client, `executors.${name}.client`, context,
      (plugin) => compatible(executor.plugin, plugin, `executors.${name}.client`))).create() : undefined;
    executor.validate(client);
    if (!discovery) for (const [index, observer] of definition.observers.entries()) await load("executor-observer", observer, `executors.${name}.observers[${index}]`, context,
      (plugin) => compatible(executor.plugin, plugin, `executors.${name}.observers[${index}]`));
  }
  await assembleProfiles(compiled, test, { ...input, values: Object.freeze({}) });
  if (test.environment) await load("environment", test.environment, `tests.${test.id}.environment`, pluginContext({ configPath: loaded.path, env: loaded.env, testId: test.id, artifacts, operations: compiled.plan.operations, aliases: compiled.aliases, mode }));
  return Object.freeze({ id: test.id, config: test, compiled, services: Object.freeze([...new Set([...test.services,
    ...test.journeys.flatMap((item) => Object.values(loaded.config.executors[item.executor].inputs).map((ref) => ref.service))])]) });
}
