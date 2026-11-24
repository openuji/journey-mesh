import { knownOptions, optionalString, optionsObject, positiveNumber, requiredString, stringArray } from "@openuji/journey-plugin";
import { JourneyConfigError } from "./errors.js";

/** A plugin reference. `use` and `options` may contain `${VAR}` and are interpolated only when selected. */
export type ComponentConfig = Readonly<{ use: string; options: Readonly<Record<string, unknown>> }>;
/** Infrastructure managed by `journey-mesh services up|down` or started for the tests that list it. */
export type ServiceOutputRef = Readonly<{ service: string; output: string }>;
/** `inputs` bind service outputs; a test using the executor also starts those services. */
export type ExecutorConfig = ComponentConfig & Readonly<{
  client?: ComponentConfig; observers: readonly ComponentConfig[]; inputs: Readonly<Record<string, ServiceOutputRef>>;
}>;
export type ServiceConfig = ComponentConfig & Readonly<{ dependsOn: readonly string[]; inputs: Readonly<Record<string, ServiceOutputRef>> }>;
function outputRef(value: unknown, label: string): ServiceOutputRef {
  const item = optionsObject(value, label);
  knownOptions(item, ["service", "output"]);
  return { service: requiredString(item.service, `${label}.service`), output: requiredString(item.output, `${label}.output`) };
}
export type EnvFileConfig = Readonly<{ path?: string; env?: string; optional?: boolean }>;
export type JourneyItemConfig = Readonly<{
  id: string; source: string; select: string; executor: string;
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
  services: readonly string[];
}>;
export type SuiteConfig = Readonly<{
  kind: "suite";
  target?: ServiceOutputRef;
  /** Name of the system under test, recorded with the run. */
  label?: string;
  outputDir?: string;
  envFiles: readonly EnvFileConfig[];
  model: ComponentConfig;
  executors: Readonly<Record<string, ExecutorConfig>>;
  profiles: Readonly<Record<string, ComponentConfig>>;
  services: Readonly<Record<string, ServiceConfig>>;
  runtimeObservers: readonly ComponentConfig[];
  /** The longest a resource owner waits for any runtime observer per event; observers may only ask for less. */
  runtimeObserverTimeoutMs: number;
  /** In YAML declaration order. */
  tests: readonly TestConfig[];
}>;

/**
 * `report` sections (suite and test level) belong to the reporting layer, which parses them itself.
 * The host accepts the key so one file can configure both, but never reads it.
 */
const reportingSection = "report";
export const defaultRuntimeObserverTimeoutMs = 30_000;

const known = (value: Record<string, unknown>, keys: readonly string[], label: string) => {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unknown setting ${label}.${key}`);
};
/** Keys renamed by the client/executor terminology. Old configurations fail and name the replacement; they are never migrated silently. */
const renamed = (value: Record<string, unknown>, keys: Readonly<Record<string, string>>, label: string) => {
  for (const [from, to] of Object.entries(keys)) {
    if (Object.hasOwn(value, from)) throw new Error(`${label ? `${label}.` : ""}\`${from}:\` was renamed to \`${to}:\``);
  }
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

function test(id: string, value: unknown, suite: Pick<SuiteConfig, "executors" | "profiles" | "services">): TestConfig {
  const raw = optionsObject(value, `tests.${id}`);
  known(raw, ["journeys", "profiles", "environment", "timeoutMs", "services", reportingSection], `tests.${id}`);
  const journeys = list(raw.journeys, `tests.${id}.journeys`).map((item, index): JourneyItemConfig => {
    const label = `tests.${id}.journeys[${index}]`;
    const journey = optionsObject(item, label);
    renamed(journey, { adapter: "executor" }, label);
    known(journey, ["id", "source", "select", "executor", "operations"], label);
    const executor = requiredString(journey.executor, `${label}.executor`);
    const itemId = requiredString(journey.id, `${label}.id`);
    if (!Object.hasOwn(suite.executors, executor)) throw new Error(`Unknown executor ${executor} for journey ${itemId}`);
    return {
      id: itemId, executor, source: requiredString(journey.source, `${label}.source`), select: requiredString(journey.select, `${label}.select`),
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
  return {
    id, journeys, profiles, services,
    ...(raw.environment !== undefined ? { environment: component(raw.environment, `tests.${id}.environment`) } : {}),
    ...(raw.timeoutMs !== undefined ? { timeoutMs: raw.timeoutMs as number | string } : {})
  };
}

/** The only place raw YAML becomes typed configuration; every unknown key is rejected. */
export function parseSuiteConfig(raw: Record<string, unknown>, testOrder: readonly string[]): SuiteConfig {
  renamed(raw, { adapters: "executors" }, "");
  known(raw, ["kind", "label", "outputDir", "envFiles", "model", "executors", "profiles", "services", "runtimeObservers", "runtimeObserverTimeoutMs", "tests", "target", reportingSection], "configuration");
  if (raw.kind !== "suite") throw new Error("Configuration kind must be suite");
  const executors = record(raw.executors, "executors", (value, name): ExecutorConfig => {
    renamed(optionsObject(value, `executors.${name}`), { driver: "client" }, `executors.${name}`);
    const executor = component(value, `executors.${name}`, ["client", "observers", "inputs"]);
    return {
      use: executor.use, options: executor.options,
      inputs: record(executor.inputs, `executors.${name}.inputs`, (ref, key) => outputRef(ref, `executors.${name}.inputs.${key}`)),
      ...(executor.client !== undefined ? { client: component(executor.client, `executors.${name}.client`) } : {}),
      observers: list(executor.observers, `executors.${name}.observers`).map((item, index) => component(item, `executors.${name}.observers[${index}]`))
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
  for (const [name, executor] of Object.entries(executors)) {
    for (const [key, ref] of Object.entries(executor.inputs)) if (!Object.hasOwn(services, ref.service)) throw new Error(`executors.${name}.inputs.${key} references unknown service ${ref.service}`);
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
  let runtimeObserverTimeoutMs: number;
  try { runtimeObserverTimeoutMs = positiveNumber(raw.runtimeObserverTimeoutMs, defaultRuntimeObserverTimeoutMs); }
  catch { throw new Error("runtimeObserverTimeoutMs must be a positive integer"); }
  if (!Number.isSafeInteger(runtimeObserverTimeoutMs)) throw new Error("runtimeObserverTimeoutMs must be a positive integer");
  const suite = { executors, profiles, services };
  const tests = testOrder.map((id) => {
    try { return test(id, (raw.tests as Record<string, unknown>)[id], suite); }
    // A structural error is not fixed by selecting another test, so no alternatives are offered.
    catch (error) { throw new JourneyConfigError(error instanceof Error ? error.message : "Invalid test", { testId: id }); }
  });
  return Object.freeze({
    kind: "suite", ...(target ? { target } : {}), envFiles, model: component(raw.model, "model"), executors, profiles, services, tests,
    runtimeObservers: list(raw.runtimeObservers, "runtimeObservers").map((entry, index) => component(entry, `runtimeObservers[${index}]`)),
    runtimeObserverTimeoutMs,
    ...(raw.label !== undefined ? { label: requiredString(raw.label, "label") } : {}),
    ...(raw.outputDir !== undefined ? { outputDir: optionalString(raw.outputDir, "outputDir") } : {})
  });
}
