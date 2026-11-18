import { resolve } from "node:path";
import { fileArtifactStore, testDirectory } from "@openuji/journey-reporter";
import type { JourneyReporter, SuiteResultBundle } from "@openuji/journey-plugin";
import type { JourneyProgressSink } from "@openuji/journey-runner";
import { JourneyConfigError, loadSuiteConfig } from "./config/load.js";
import { compileTest } from "./compile.js";
import { assembleTest, type AssembledTest } from "./assemble.js";
import { executeSuite, type PreparedSuite } from "./execute.js";
import { pluginContext } from "./plugins/context.js";
import { pluginLoader } from "./plugins/loader.js";
import { loadServices, orderServices, outputDirectory } from "./services.js";

export type RunSuiteOptions = {
  /** Run only this test; without it every test must pass preflight. */
  test?: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  progress?: readonly JourneyProgressSink[];
  outputDir?: string;
};

/**
 * Preflight: load the configuration, then compile and assemble every selected test. Plugins parse
 * and construct components, but nothing is started, so a broken test never leaves fixtures behind.
 */
export async function prepareSuite(path: string, options: RunSuiteOptions = {}): Promise<PreparedSuite> {
  const loaded = await loadSuiteConfig(path, options.env);
  const { config } = loaded;
  const testIds = config.tests.map((test) => test.id);
  const selected = config.tests.filter((test) => options.test === undefined || test.id === options.test);
  if (!selected.length) throw new JourneyConfigError(`Unknown test ${options.test}`, { testIds });
  let current: string | undefined;
  try {
    const outputDir = outputDirectory(loaded, options.outputDir);
    const load = pluginLoader(loaded.path, loaded.env);
    const artifacts = fileArtifactStore(outputDir);
    const suiteContext = (testId: string) => pluginContext({ configPath: loaded.path, env: loaded.env, testId, artifacts });
    const compiler = await (await load("model", config.model, "model", suiteContext("suite"))).create();
    const tests: AssembledTest[] = [];
    for (const test of selected) {
      current = test.id;
      const compiled = await compileTest(test, compiler, loaded.path, loaded.env);
      tests.push(await assembleTest(test, compiled, { loaded, load, artifacts: fileArtifactStore(resolve(outputDir, testDirectory(test.id))) }));
    }
    current = undefined;
    const reporters: JourneyReporter[] = [];
    for (const [index, entry] of config.reporters.entries()) reporters.push(await (await load("reporter", entry, `reporters[${index}]`, suiteContext("suite"))).create());
    const keys = [...new Set(tests.flatMap((test) => test.services))];
    const services = keys.length ? await loadServices(loaded, load, orderServices(config.services, keys), outputDir, true) : [];
    return Object.freeze({ ...(config.target ? { target: config.target } : {}), ...(config.label ? { label: config.label } : {}), outputDir, tests, services, reporters, artifacts });
  } catch (error) {
    if (error instanceof JourneyConfigError && error.testIds.length) throw error;
    throw new JourneyConfigError(error instanceof Error ? error.message : "Invalid journey test configuration", { testId: current, testIds });
  }
}

export async function validateSuite(path: string, options: RunSuiteOptions = {}): Promise<{ tests: readonly string[] }> {
  return { tests: (await prepareSuite(path, options)).tests.map((test) => test.id) };
}

export async function runSuite(path: string, options: RunSuiteOptions = {}): Promise<SuiteResultBundle> {
  return executeSuite(await prepareSuite(path, options), options);
}
