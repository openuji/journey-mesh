import { dirname, resolve } from "node:path";
import type { AdapterDiscoveryInput, DiscoveredMaterialization, MaterializationWrite } from "@openuji/journey-plugin";
import { interpolate, JourneyConfigError, loadSuiteConfig, type Environment } from "./config/load.js";
import type { TestConfig } from "./config/schema.js";
import { pluginContext, preflightArtifacts } from "./plugins/context.js";
import { pluginLoader } from "./plugins/loader.js";

/**
 * A discovery run (`journey-mesh discover`). Every journey of a selected test must run on an adapter
 * that declares a discovery mode; any other test is rejected in preflight. Executor observers are not
 * attached, and profiles accept transitions without declared steps. A test run never sets this.
 */
export type SuiteDiscovery = Readonly<{
  /** Measure declared steps again as well, so they can be replaced. */
  rediscover: boolean;
  /** Receives every finding, with the test that produced it. */
  record(finding: DiscoveredMaterialization): Promise<void> | void;
}>;

/** The findings port of one test: the adapter reports, the host adds the test. */
export function discoveryInput(testId: string, discovery: SuiteDiscovery): AdapterDiscoveryInput {
  return Object.freeze({
    rediscover: discovery.rediscover,
    findings: Object.freeze({ record: (finding: Omit<DiscoveredMaterialization, "testId">) => discovery.record(Object.freeze({ testId, ...finding })) })
  });
}

/** Preflight of a discovery run: a journey on an adapter without a discovery mode cannot be discovered. */
export function undiscoverableAdapter(test: TestConfig, adapter: string, use: string): Error {
  const journeys = test.journeys.filter((item) => item.adapter === adapter).map((item) => item.id);
  return new Error(`Test ${test.id} cannot be discovered: journeys ${journeys.join(", ")} run on adapter ${adapter} (${use}), which has no discovery mode`);
}

export type DeclaredSource = Readonly<{ source: string; document?: string; writes: readonly MaterializationWrite[] }>;

/**
 * Declare reviewed findings in the model sources of the selected tests, through the suite's model
 * plugin. Returns each source's rewritten document and what was written; nothing is written to disk.
 */
export async function declareFindings(
  path: string,
  found: readonly DiscoveredMaterialization[],
  options: Readonly<{ test?: string; env?: Environment }> = {}
): Promise<readonly DeclaredSource[]> {
  const loaded = await loadSuiteConfig(path, options.env);
  const { config } = loaded;
  const selected = config.tests.filter((test) => options.test === undefined || test.id === options.test);
  if (!selected.length) throw new JourneyConfigError(`Unknown test ${options.test}`, { testIds: config.tests.map((test) => test.id) });
  const load = pluginLoader(loaded.path, loaded.env);
  const compiler = await (await load("model", config.model, "model", pluginContext({ configPath: loaded.path, env: loaded.env, testId: "suite", artifacts: preflightArtifacts }))).create();
  if (!compiler.declareMaterializations) throw new JourneyConfigError(`The model plugin ${config.model.use} cannot declare discovered steps`);
  const sources = [...new Set(selected.flatMap((test) => test.journeys.map((item) =>
    resolve(dirname(loaded.path), interpolate(item.source, loaded.env, `journey ${item.id}.source`)))))];
  const declared: DeclaredSource[] = [];
  for (const source of sources) declared.push(Object.freeze({ source, ...await compiler.declareMaterializations(source, found) }));
  return Object.freeze(declared);
}
