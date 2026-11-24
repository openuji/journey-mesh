import { type SuiteRun } from "@openuji/journey-run-record";
import type { JourneyProgressSink } from "@openuji/journey-runner";
import { JourneyConfigError, loadSuiteConfig } from "./config/load.js";
import { compileTest } from "./compile.js";
import { prepareTest, type PreparedTest } from "./assemble.js";
import type { SuiteDiscovery } from "./discovery.js";
import { executeSuite, type PreparedSuite } from "./execute.js";
import { pluginContext, preflightArtifacts } from "./plugins/context.js";
import { pluginLoader } from "./plugins/loader.js";
import { validateInputs } from "./inputs.js";
import { loadServices, orderServices, outputDirectory } from "./services.js";

export type RunSuiteOptions = {
  /** Run only this test; without it every test must pass preflight. */
  test?: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  progress?: readonly JourneyProgressSink[];
  outputDir?: string;
  /** Run only this profile combination of each selected test. */
  profile?: string;
  /** A discovery run (`journey-mesh discover`); a test run never sets it. */
  discovery?: SuiteDiscovery;
};

/**
 * Preflight compiles selected tests, parses immutable settings and checks operations.
 * Runtime adapters, observers, services and their evidence stores are constructed per run.
 */
export async function prepareSuite(path: string, options: RunSuiteOptions = {}): Promise<PreparedSuite> {
  const loaded = await loadSuiteConfig(path, options.env);
  const { config } = loaded;
  const testIds = config.tests.map((test) => test.id);
  const selected = config.tests.filter((test) => options.test === undefined || test.id === options.test).map((test) => {
    if (options.profile === undefined) return test;
    const profiles = test.profiles.filter((combination) => combination.id === options.profile);
    if (!profiles.length) throw new JourneyConfigError(`Test ${test.id} has no profile combination ${options.profile}`, { testId: test.id, testIds });
    return Object.freeze({ ...test, profiles: Object.freeze(profiles) });
  });
  if (!selected.length) throw new JourneyConfigError(`Unknown test ${options.test}`, { testIds });
  const mode = options.discovery ? "discovery" as const : "test" as const;
  let current: string | undefined;
  try {
    const outputDir = outputDirectory(loaded, options.outputDir);
    const load = pluginLoader(loaded.path, loaded.env);
    const artifacts = preflightArtifacts;
    const suiteContext = (testId: string) => pluginContext({ configPath: loaded.path, env: loaded.env, testId, artifacts, mode });
    const compiler = await (await load("model", config.model, "model", suiteContext("suite"))).create();
    const tests: PreparedTest[] = [];
    for (const test of selected) {
      current = test.id;
      const compiled = await compileTest(test, compiler, loaded.path, loaded.env);
      tests.push(await prepareTest(test, compiled, { loaded, load, artifacts: preflightArtifacts, ...(options.discovery ? { discovery: options.discovery } : {}) }));
    }
    current = undefined;
    const keys = [...new Set(tests.flatMap((test) => test.services))];
    const services = await loadServices(loaded, load, orderServices(config.services, keys), true);
    const runtimeObservers = await Promise.all(config.runtimeObservers.map((observer, index) =>
      load("runtime-observer", observer, `runtimeObservers[${index}]`, suiteContext("suite"))));
    const contracts = Object.fromEntries(services.map((entry) => [entry.key, entry.component.plugin.outputs ?? {}]));
    for (const test of tests) for (const name of new Set(test.config.journeys.map((item) => item.adapter))) {
      const definition = config.adapters[name];
      const component = await load("adapter", definition, `adapters.${name}`, suiteContext(test.id), undefined, Object.keys(definition.inputs));
      validateInputs(component.plugin, definition.inputs, contracts, `adapters.${name}`);
    }
    return Object.freeze({ ...(config.target ? { target: config.target } : {}), ...(config.label ? { label: config.label } : {}), outputDir, tests: Object.freeze(tests), services: Object.freeze(services), runtimeObservers: Object.freeze(runtimeObservers), loaded,
      ...(options.discovery ? { discovery: options.discovery } : {}) });
  } catch (error) {
    if (error instanceof JourneyConfigError && error.testIds.length) throw error;
    throw new JourneyConfigError(error instanceof Error ? error.message : "Invalid journey test configuration", { testId: current, testIds });
  }
}

export async function validateSuite(path: string, options: RunSuiteOptions = {}): Promise<{ tests: readonly string[] }> {
  return { tests: (await prepareSuite(path, options)).tests.map((test) => test.id) };
}

export async function runSuite(path: string, options: RunSuiteOptions = {}): Promise<SuiteRun> {
  return executeSuite(await prepareSuite(path, options), options);
}
