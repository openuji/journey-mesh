import { knownOptions, optionalString, optionsObject, requiredString, stringArray, reportFileLimit } from "@openuji/journey-plugin";
import { JourneyConfigError } from "./errors.js";
import type { JourneyReportOptions, SuiteReportOptions } from "@openuji/journey-plugin";

/** A plugin reference. `use` and `options` may contain `${VAR}` and are interpolated only when selected. */
export type ComponentConfig = Readonly<{ use: string; options: Readonly<Record<string, unknown>> }>;
export type AdapterConfig = ComponentConfig & Readonly<{ driver?: ComponentConfig; observers: readonly ComponentConfig[] }>;
/** Infrastructure managed by `journey-mesh services up|down` or started for the tests that list it. */
export type ServiceOutputRef = Readonly<{ service: string; output: string }>;
export type ServiceConfig = ComponentConfig & Readonly<{ dependsOn: readonly string[]; inputs: Readonly<Record<string, ServiceOutputRef>> }>;
function outputRef(value: unknown, label: string): ServiceOutputRef {
  const item = optionsObject(value, label);
  knownOptions(item, ["service", "output"]);
  return { service: requiredString(item.service, `${label}.service`), output: requiredString(item.output, `${label}.output`) };
}
export type EnvFileConfig = Readonly<{ path?: string; env?: string; optional?: boolean }>;
export type JourneyItemConfig = Readonly<{
  id: string; source: string; select: string; adapter: string;
  /** Stable names for model operations, e.g. `goal: urn:transition:…`, referenced as `<id>.<name>`. */
  operations: Readonly<Record<string, string>>;
}>;
/** One execution of a test: which profile drives each journey item. */
export type ProfileCombinationConfig = Readonly<{ id: string; journeys: Readonly<Record<string, string>> }>;
export type TestConfig = Readonly<{
  id: string;
  journeys: readonly JourneyItemConfig[];
  profiles: readonly ProfileCombinationConfig[];
  environment?: ComponentConfig;
  timeoutMs?: number | string;
  report?: JourneyReportOptions;
  reporters: readonly ComponentConfig[];
  services: readonly string[];
}>;
export type SuiteConfig = Readonly<{
  kind: "suite";
  target?: ServiceOutputRef;
  /** Name of the system under test, shown in reports and comparisons. */
  label?: string;
  outputDir?: string;
  report?: SuiteReportOptions;
  envFiles: readonly EnvFileConfig[];
  model: ComponentConfig;
  adapters: Readonly<Record<string, AdapterConfig>>;
  profiles: Readonly<Record<string, ComponentConfig>>;
  services: Readonly<Record<string, ServiceConfig>>;
  /** In YAML declaration order. */
  tests: readonly TestConfig[];
  reporters: readonly ComponentConfig[];
}>;

const known = (value: Record<string, unknown>, keys: readonly string[], label: string) => {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unknown setting ${label}.${key}`);
};
const list = (value: unknown, label: string): unknown[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
};
const record = <T>(value: unknown, label: string, parse: (item: unknown, key: string) => T): Record<string, T> =>
  Object.fromEntries(Object.entries(optionsObject(value ?? {}, label)).map(([key, item]) => [key, parse(item, key)]));

function component(value: unknown, label: string, extra: readonly string[] = []): ComponentConfig & Record<string, unknown> {
  const raw = optionsObject(value, label);
  known(raw, ["use", "options", ...extra], label);
  return { ...raw, use: requiredString(raw.use, `${label}.use`), options: optionsObject(raw.options ?? {}, `${label}.options`) };
}

function reportOptions(value: unknown, label: string, suite = false): SuiteReportOptions | undefined {
  if (value === undefined) return undefined;
  const raw = optionsObject(value, label);
  known(raw, ["excludedPhaseIds", ...(suite ? ["maxFileSizeMiB"] : [])], label);
  if (raw.maxFileSizeMiB !== undefined) reportFileLimit(raw.maxFileSizeMiB);
  return { excludedPhaseIds: raw.excludedPhaseIds === undefined ? [] : stringArray(raw.excludedPhaseIds, `${label}.excludedPhaseIds`),
    ...(raw.maxFileSizeMiB === undefined ? {} : { maxFileSizeMiB: raw.maxFileSizeMiB as number }) };
}

function test(id: string, value: unknown, suite: Pick<SuiteConfig, "adapters" | "profiles" | "services" | "report">): TestConfig {
  const raw = optionsObject(value, `tests.${id}`);
  known(raw, ["journeys", "profiles", "environment", "timeoutMs", "reporters", "services", "report"], `tests.${id}`);
  const journeys = list(raw.journeys, `tests.${id}.journeys`).map((item, index): JourneyItemConfig => {
    const label = `tests.${id}.journeys[${index}]`;
    const journey = optionsObject(item, label);
    known(journey, ["id", "source", "select", "adapter", "operations"], label);
    const adapter = requiredString(journey.adapter, `${label}.adapter`);
    const itemId = requiredString(journey.id, `${label}.id`);
    if (!Object.hasOwn(suite.adapters, adapter)) throw new Error(`Unknown adapter ${adapter} for journey ${itemId}`);
    return {
      id: itemId, adapter, source: requiredString(journey.source, `${label}.source`), select: requiredString(journey.select, `${label}.select`),
      operations: record(journey.operations, `${label}.operations`, (selector, name) => requiredString(selector, `${label}.operations.${name}`))
    };
  });
  if (!journeys.length) throw new Error(`Test ${id} needs at least one journey`);
  const itemIds = new Set<string>();
  for (const item of journeys) {
    if (itemIds.has(item.id)) throw new Error(`Duplicate journey item ${item.id} in test ${id}`);
    itemIds.add(item.id);
  }
  const combinationIds = new Set<string>();
  const profiles = list(raw.profiles, `tests.${id}.profiles`).map((item): ProfileCombinationConfig => {
    const combination = optionsObject(item, `test ${id} profile`);
    known(combination, ["id", "journeys"], `test ${id} profile`);
    const combinationId = requiredString(combination.id, "profile combination id");
    if (combinationIds.has(combinationId)) throw new Error(`Duplicate profile combination ${combinationId}`);
    combinationIds.add(combinationId);
    const assignments = optionsObject(combination.journeys, `profile ${combinationId}.journeys`);
    for (const key of Object.keys(assignments)) if (!itemIds.has(key)) throw new Error(`Unknown journey ${key} in profile ${combinationId}`);
    const journeysByItem = Object.fromEntries([...itemIds].map((itemId) => {
      const name = requiredString(assignments[itemId], `profile ${combinationId}.journeys.${itemId}`);
      if (!Object.hasOwn(suite.profiles, name)) throw new Error(`Unknown profile ${name}`);
      return [itemId, name];
    }));
    return { id: combinationId, journeys: journeysByItem };
  });
  if (!profiles.length) throw new Error(`Test ${id} needs at least one profile combination`);
  const services = list(raw.services, `tests.${id}.services`).map((key) => {
    const name = requiredString(key, `tests.${id}.services`);
    if (!Object.hasOwn(suite.services, name)) throw new Error(`tests.${id}.services references unknown service ${name}`);
    return name;
  });
  if (raw.timeoutMs !== undefined && typeof raw.timeoutMs !== "number" && typeof raw.timeoutMs !== "string") throw new Error(`tests.${id}.timeoutMs must be a number`);
  const report = raw.report === undefined ? (suite.report ? { excludedPhaseIds: suite.report.excludedPhaseIds } : undefined) : reportOptions(raw.report, `tests.${id}.report`);
  return {
    id, journeys, profiles, services,
    ...(report ? { report } : {}),
    reporters: list(raw.reporters, `tests.${id}.reporters`).map((item, index) => component(item, `tests.${id}.reporters[${index}]`)),
    ...(raw.environment !== undefined ? { environment: component(raw.environment, `tests.${id}.environment`) } : {}),
    ...(raw.timeoutMs !== undefined ? { timeoutMs: raw.timeoutMs as number | string } : {})
  };
}

/** The only place raw YAML becomes typed configuration; every unknown key is rejected. */
export function parseSuiteConfig(raw: Record<string, unknown>, testOrder: readonly string[]): SuiteConfig {
  known(raw, ["kind", "label", "outputDir", "envFiles", "model", "adapters", "profiles", "services", "tests", "reporters", "target", "report"], "configuration");
  if (raw.kind !== "suite") throw new Error("Configuration kind must be suite");
  const adapters = record(raw.adapters, "adapters", (value, name): AdapterConfig => {
    const adapter = component(value, `adapters.${name}`, ["driver", "observers"]);
    return {
      use: adapter.use, options: adapter.options,
      ...(adapter.driver !== undefined ? { driver: component(adapter.driver, `adapters.${name}.driver`) } : {}),
      observers: list(adapter.observers, `adapters.${name}.observers`).map((item, index) => component(item, `adapters.${name}.observers[${index}]`))
    };
  });
  const profiles = record(raw.profiles, "profiles", (value, name) => component(value, `profiles.${name}`));
  const services = record(raw.services, "services", (value, name): ServiceConfig => {
    const service = component(value, `services.${name}`, ["dependsOn", "inputs"]);
    const inputs = record(service.inputs, `services.${name}.inputs`, (ref, key) => outputRef(ref, `services.${name}.inputs.${key}`));
    return { use: service.use, options: service.options, inputs, dependsOn: [...new Set([
      ...(service.dependsOn === undefined ? [] : stringArray(service.dependsOn, `services.${name}.dependsOn`)),
      ...Object.values(inputs).map((ref) => ref.service)
    ])] };
  });
  for (const [name, service] of Object.entries(services)) {
    for (const dependency of service.dependsOn) if (!Object.hasOwn(services, dependency)) throw new Error(`services.${name}.dependsOn references unknown service ${dependency}`);
  }
  const target = raw.target === undefined ? undefined : outputRef(raw.target, "target");
  if (target && !Object.hasOwn(services, target.service)) throw new Error(`Unknown target service ${target.service}`);
  optionsObject(raw.tests, "tests");
  if (!testOrder.length) throw new Error("At least one test is required");
  const envFiles = list(raw.envFiles, "envFiles").map((entry, index): EnvFileConfig => {
    if (typeof entry === "string") return { path: entry };
    const item = optionsObject(entry, `envFiles[${index}]`);
    knownOptions(item, ["path", "env", "optional"]);
    if (item.path === undefined && item.env === undefined) throw new Error(`envFiles[${index}] needs path or env`);
    return { ...(item.path !== undefined ? { path: requiredString(item.path, "envFiles.path") } : {}), ...(item.env !== undefined ? { env: requiredString(item.env, "envFiles.env") } : {}), ...(item.optional === true ? { optional: true } : {}) };
  });
  const report = reportOptions(raw.report, "report", true);
  const suite = { adapters, profiles, services, report };
  const tests = testOrder.map((id) => {
    try { return test(id, (raw.tests as Record<string, unknown>)[id], suite); }
    // A structural error is not fixed by selecting another test, so no alternatives are offered.
    catch (error) { throw new JourneyConfigError(error instanceof Error ? error.message : "Invalid test", { testId: id }); }
  });
  return Object.freeze({
    kind: "suite", ...(target ? { target } : {}), envFiles, model: component(raw.model, "model"), adapters, profiles, services, tests,
    ...(report ? { report } : {}),
    reporters: list(raw.reporters, "reporters").map((item, index) => component(item, `reporters[${index}]`)),
    ...(raw.label !== undefined ? { label: requiredString(raw.label, "label") } : {}),
    ...(raw.outputDir !== undefined ? { outputDir: optionalString(raw.outputDir, "outputDir") } : {})
  });
}
