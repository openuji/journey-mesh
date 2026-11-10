import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import {
  errorToJourneyRunError, reportJourneyResult, routedAdapter, runJourney,
  type JourneyAdapter, type JourneyAdapterRuntime, type JourneyEnvironment, type JourneyPlan, type JourneyPlanOperation,
  type JourneyProfile, type JourneyReporter, type JourneyRunError, type JourneyProgressSink, type RunResult
} from "@openuji/journey-runner";
import { immutableJourneyPlan } from "@openuji/journey-execution-model";
import { renderJourneyRunSummary } from "@openuji/journey-runner/console";
import { fileArtifactStore, escapeHtml } from "./artifacts.js";
import { interpolate, JourneyConfigError, loadJourneyTestConfig, type ComponentConfig } from "./config.js";
import {
  optionsObject, positiveNumber, requiredString,
  type JourneyArtifact, type JourneyArtifactStore, type JourneyMeshPlugin, type JourneyModelCompiler,
  type JourneyObserverComponent, type JourneyPluginContext, type JourneyPluginDependencies, type JourneyPluginKind
} from "./plugin.js";

export type ConfiguredTestResult = {
  id: string;
  result: RunResult;
  reportingErrors: readonly JourneyRunError[];
  artifacts: readonly JourneyArtifact[];
};
export type ConfiguredTestsResult = { ok: boolean; outputDir: string; tests: readonly ConfiguredTestResult[] };
export type ConfiguredTestsOptions = { test?: string; env?: Record<string, string | undefined>; signal?: AbortSignal; progress?: readonly JourneyProgressSink[] };
type PreparedTest = {
  id: string; plan: JourneyPlan; adapter: JourneyAdapter; profiles: JourneyProfile[];
  environment?: JourneyEnvironment; reporters: JourneyReporter[]; artifacts: JourneyArtifactStore; timeoutMs: number;
};

function checkKeys(object: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(object)) if (!allowed.includes(key)) throw new Error(`Unknown setting ${label}.${key}`);
}

async function prepare(path: string, options: ConfiguredTestsOptions): Promise<{ tests: PreparedTest[]; outputDir: string }> {
  const loaded = await loadJourneyTestConfig(path, options.env);
  const { config } = loaded;
  let preparingTestId: string | undefined;
  try {
    checkKeys(config as unknown as Record<string, unknown>, ["version", "envFiles", "model", "adapters", "profiles", "tests", "outputDir", "runtimes"], "configuration");
    const outputDir = resolve(dirname(loaded.path), interpolate(config.outputDir ?? "test-results", loaded.env, "outputDir"));
    const selected = loaded.testOrder.map((id) => [id, config.tests[id]] as const).filter(([id]) => options.test === undefined || id === options.test);
    if (!selected.length) throw new Error(`Unknown test ${options.test}`);
    const tests: PreparedTest[] = [];
    const modules = new Map<string, Promise<JourneyMeshPlugin>>();
    for (const [testId, definition] of selected) {
      preparingTestId = testId;
      const test = optionsObject(definition, `tests.${testId}`);
      checkKeys(test, ["journeys", "profiles", "environment", "timeoutMs"], `tests.${testId}`);
      if (!Array.isArray(test.journeys) || !test.journeys.length) throw new Error(`Test ${testId} needs at least one journey`);
      if (!Array.isArray(test.profiles) || !test.profiles.length) throw new Error(`Test ${testId} needs at least one profile combination`);
      const artifacts = fileArtifactStore(resolve(outputDir, testDirectory(testId)));
      const context: JourneyPluginContext = {
        operations: [], artifacts, configPath: loaded.path, testId, env: loaded.env,
        resolvePath: (value) => resolve(dirname(loaded.path), value)
      };
      let pluginOperations: readonly JourneyPlanOperation[] = [];
      const load = async (input: ComponentConfig, kind: JourneyPluginKind, label: string) => {
        const component = optionsObject(input, label);
        checkKeys(component, kind === "adapter" ? ["use", "options", "driver", "observers"] : ["use", "options"], label);
        const reference = interpolate(requiredString(component.use, `${label}.use`), loaded.env, `${label}.use`);
        let modulePath: string;
        if (reference.startsWith(".") || reference.startsWith("/")) modulePath = context.resolvePath(reference);
        else modulePath = createRequire(loaded.path).resolve(reference);
        let pending = modules.get(modulePath);
        if (!pending) {
          pending = import(pathToFileURL(modulePath).href).then((module: { journeyMeshPlugin?: JourneyMeshPlugin }) => {
            const plugin = module.journeyMeshPlugin;
            if (!plugin || plugin.apiVersion !== 1 || typeof plugin.validate !== "function" || typeof plugin.create !== "function") {
              throw new Error(`Plugin ${reference} must export journeyMeshPlugin with apiVersion 1, validate and create`);
            }
            return plugin;
          });
          modules.set(modulePath, pending);
        }
        const plugin = await pending;
        if (plugin.kind !== kind) throw new Error(`${label} requires a ${kind} plugin, received ${plugin.kind}`);
        const settings = interpolate(optionsObject(component.options ?? {}, `${label}.options`), loaded.env, `${label}.options`);
        const pluginContext = { ...context, operations: pluginOperations };
        try { await plugin.validate(settings, pluginContext); }
        catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : "invalid options"}`); }
        return { plugin, settings, create: (dependencies: JourneyPluginDependencies = {}) => plugin.create(settings, pluginContext, dependencies) };
      };
      const model = await load(config.model, "model", "model");
      const compiler = await model.create() as JourneyModelCompiler;
      if (!compiler || typeof compiler.compile !== "function") throw new Error("Model plugin must create a compiler");
      const itemIds = new Set<string>();
      const adapterNames = new Set<string>();
      const operations: JourneyPlanOperation[] = [];
      for (const raw of test.journeys) {
        const item = optionsObject(raw, `test ${testId} journey`);
        checkKeys(item, ["id", "source", "select", "adapter"], `test ${testId} journey`);
        const id = requiredString(item.id, "journey.id");
        if (itemIds.has(id)) throw new Error(`Duplicate journey item ${id} in test ${testId}`);
        itemIds.add(id);
        const adapter = requiredString(item.adapter, `journey ${id}.adapter`);
        if (!Object.hasOwn(config.adapters, adapter)) throw new Error(`Unknown adapter ${adapter} for journey ${id}`);
        adapterNames.add(adapter);
        const source = context.resolvePath(interpolate(requiredString(item.source, `journey ${id}.source`), loaded.env, `journey ${id}.source`));
        const selection = requiredString(item.select, `journey ${id}.select`);
        const child = await compiler.compile(source, selection);
        if (!child.operations.length) throw new Error(`Journey ${id} has no executable operations`);
        for (const operation of child.operations) {
          operations.push({
            ...operation, id: `${encodeURIComponent(testId)}/${encodeURIComponent(id)}/${operation.id}`, sequence: operations.length,
            source: { references: {
              ...operation.source?.references,
              originalOperationId: operation.id, documentId: child.source?.documentId ?? source,
              source, journeyId: selection, testId, journeyItemId: id, adapterId: adapter
            } }
          });
        }
      }
      const plan: JourneyPlan = immutableJourneyPlan({
        id: `journey-test:${encodeURIComponent(testId)}`,
        source: { model: "journey-mesh-test", references: { testId, config: loaded.path } }, operations
      });
      const reporters: JourneyReporter[] = [];
      const adapters = new Map<string, JourneyAdapter>();
      for (const name of adapterNames) {
        pluginOperations = operations.filter((operation) => operation.source!.references!.adapterId === name);
        const definition = config.adapters[name];
        const factory = await load(definition, "adapter", `adapters.${name}`);
        let driver: unknown;
        if (definition.driver) {
          const driverFactory = await load(definition.driver, "driver", `adapters.${name}.driver`);
          compatible(factory.plugin, driverFactory.plugin, `adapters.${name}.driver`);
          driver = await driverFactory.create();
        }
        if (definition.observers !== undefined && !Array.isArray(definition.observers)) throw new Error(`adapters.${name}.observers must be an array`);
        const observers: unknown[] = [];
        for (const [index, entry] of (definition.observers ?? []).entries()) {
          const observerFactory = await load(entry, "observer", `adapters.${name}.observers[${index}]`);
          compatible(factory.plugin, observerFactory.plugin, `adapters.${name}.observers[${index}]`);
          const component = await observerFactory.create() as JourneyObserverComponent;
          if (!component || !component.observer) throw new Error("Observer plugin must create an observer component");
          observers.push(component.observer);
          if (component.reporter) reporters.push(component.reporter);
        }
        const adapter = await factory.create({ driver, observers }) as JourneyAdapter;
        if (!adapter || typeof adapter.createExecution !== "function") throw new Error(`Adapter ${name} must create a JourneyAdapter`);
        adapters.set(name, adapter);
      }
      const adapter = routedAdapter((operation) => adapters.get(String(operation.source!.references!.adapterId))!);
      for (const operation of operations) adapter.describeOperation?.(operation);
      pluginOperations = operations;
      const profileNames = new Map<string, JourneyProfile>();
      const profiles: JourneyProfile[] = [];
      const combinationIds = new Set<string>();
      for (const raw of test.profiles) {
        const combination = optionsObject(raw, `test ${testId} profile`);
        checkKeys(combination, ["id", "journeys"], `test ${testId} profile`);
        const id = requiredString(combination.id, "profile combination id");
        if (combinationIds.has(id)) throw new Error(`Duplicate profile combination ${id}`);
        combinationIds.add(id);
        const assignments = optionsObject(combination.journeys, `profile ${id}.journeys`);
        for (const key of Object.keys(assignments)) if (!itemIds.has(key)) throw new Error(`Unknown journey ${key} in profile ${id}`);
        const children = new Map<string, JourneyProfile>();
        for (const itemId of itemIds) {
          const name = requiredString(assignments[itemId], `profile ${id}.journeys.${itemId}`);
          if (!Object.hasOwn(config.profiles, name)) throw new Error(`Unknown profile ${name}`);
          if (!profileNames.has(name)) profileNames.set(name, await (await load(config.profiles[name], "profile", `profiles.${name}`)).create() as JourneyProfile);
          const child = profileNames.get(name)!;
          requiredString(child?.id, `profiles.${name}.id`);
          children.set(itemId, child);
        }
        const childFor = (operation: JourneyPlanOperation) => children.get(String(operation.source!.references!.journeyItemId))!;
        const profile: JourneyProfile = {
          id,
          appliesTo: (operation, context) => {
            const child = childFor(operation);
            return child.appliesTo?.(operation, { ...context, profile: child }) ?? true;
          },
          async selectInputModality(operation, context) {
            const child = childFor(operation);
            if (!child.selectInputModality) throw new Error(`Profile ${child.id} cannot select an input modality`);
            return { ...await child.selectInputModality(operation, { ...context, profile: child }), profileId: id };
          }
        };
        // Modality selection is resource-free; do not discover incompatible combinations after fixtures.
        const assessmentContext = { runId: "preflight", executionId: "preflight", plan, profile };
        let applicable = true;
        for (const operation of operations) if (!await profile.appliesTo!(operation, assessmentContext)) { applicable = false; break; }
        if (applicable) for (const operation of operations) {
          if (operation.kind === "transition" && operation.activation.requiredInputModalityProfiles.length) await profile.selectInputModality!(operation, assessmentContext);
        }
        profiles.push(profile);
      }
      let environment: JourneyEnvironment | undefined;
      if (definition.environment) environment = await (await load(definition.environment, "environment", `tests.${testId}.environment`)).create() as JourneyEnvironment;
      tests.push({ id: testId, plan, adapter, profiles, environment, reporters, artifacts,
        timeoutMs: positiveNumber(interpolate(definition.timeoutMs, loaded.env, `tests.${testId}.timeoutMs`), 600_000) });
    }
    return { tests, outputDir };
  } catch (error) {
    throw new JourneyConfigError(error instanceof Error ? error.message : "Invalid journey test configuration", { testId: preparingTestId, testIds: loaded.testOrder });
  }
}
function compatible(adapter: JourneyMeshPlugin, child: JourneyMeshPlugin, label: string): void {
  if (child.kind === "driver") {
    if (!adapter.driverContract) throw new Error(`${label} cannot be used because the adapter declares no driver contract`);
    if (child.driverContract !== adapter.driverContract) {
      throw new Error(`${label} driver contract ${child.driverContract ?? "unspecified"} is incompatible with ${adapter.driverContract}`);
    }
    return;
  }
  if (child.runtime && child.runtime !== adapter.runtime) {
    throw new Error(`${label} runtime ${child.runtime} is incompatible with adapter runtime ${adapter.runtime ?? "unspecified"}`);
  }
}

export type ConfiguredRuntimeOptions = { runtime?: string; env?: Record<string, string | undefined> };

/** Dependencies first (for `up`); the caller reverses the order itself for `down`. */
function orderRuntimes(runtimes: Record<string, unknown>): string[] {
  const order: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error(`Circular runtimes.dependsOn involving ${key}`);
    visiting.add(key);
    const component = optionsObject(runtimes[key], `runtimes.${key}`);
    const dependsOn = component.dependsOn;
    if (dependsOn !== undefined) {
      if (!Array.isArray(dependsOn)) throw new Error(`runtimes.${key}.dependsOn must be an array`);
      for (const dependency of dependsOn) {
        const name = requiredString(dependency, `runtimes.${key}.dependsOn`);
        if (!Object.hasOwn(runtimes, name)) throw new Error(`runtimes.${key}.dependsOn references unknown runtime ${name}`);
        visit(name);
      }
    }
    visiting.delete(key);
    visited.add(key);
    order.push(key);
  };
  for (const key of Object.keys(runtimes)) visit(key);
  return order;
}

async function loadConfiguredRuntimes(path: string, options: ConfiguredRuntimeOptions): Promise<{ key: string; runtime: JourneyAdapterRuntime }[]> {
  const loaded = await loadJourneyTestConfig(path, options.env);
  const { config } = loaded;
  checkKeys(config as unknown as Record<string, unknown>, ["version", "envFiles", "model", "adapters", "profiles", "tests", "outputDir", "runtimes"], "configuration");
  const runtimes = optionsObject(config.runtimes ?? {}, "runtimes");
  if (options.runtime !== undefined && !Object.hasOwn(runtimes, options.runtime)) throw new Error(`Unknown runtime ${options.runtime}`);
  const keys = options.runtime !== undefined ? [options.runtime] : orderRuntimes(runtimes);
  const outputDir = resolve(dirname(loaded.path), interpolate(config.outputDir ?? "test-results", loaded.env, "outputDir"));
  const artifacts = fileArtifactStore(resolve(outputDir, ".runtimes"));
  const context: JourneyPluginContext = {
    artifacts, configPath: loaded.path, testId: "runtime", operations: [], env: loaded.env,
    resolvePath: (value) => resolve(dirname(loaded.path), value)
  };
  const modules = new Map<string, Promise<JourneyMeshPlugin>>();
  const result: { key: string; runtime: JourneyAdapterRuntime }[] = [];
  for (const key of keys) {
    const label = `runtimes.${key}`;
    const component = optionsObject(runtimes[key], label);
    checkKeys(component, ["use", "options", "dependsOn"], label);
    const reference = interpolate(requiredString(component.use, `${label}.use`), loaded.env, `${label}.use`);
    const modulePath = reference.startsWith(".") || reference.startsWith("/")
      ? context.resolvePath(reference)
      : createRequire(loaded.path).resolve(reference);
    let pending = modules.get(modulePath);
    if (!pending) {
      pending = import(pathToFileURL(modulePath).href).then((module: { journeyMeshPlugin?: JourneyMeshPlugin }) => {
        const plugin = module.journeyMeshPlugin;
        if (!plugin || plugin.apiVersion !== 1 || typeof plugin.validate !== "function" || typeof plugin.create !== "function") {
          throw new Error(`Plugin ${reference} must export journeyMeshPlugin with apiVersion 1, validate and create`);
        }
        if (plugin.kind !== "runtime") throw new Error(`${label} requires a runtime plugin, received ${plugin.kind}`);
        return plugin;
      });
      modules.set(modulePath, pending);
    }
    const plugin = await pending;
    const settings = interpolate(optionsObject(component.options ?? {}, `${label}.options`), loaded.env, `${label}.options`);
    try { await plugin.validate(settings, context); }
    catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : "invalid options"}`); }
    const runtime = await plugin.create(settings, context, {}) as JourneyAdapterRuntime;
    if (!runtime || typeof runtime.up !== "function") throw new Error(`${label} must create a JourneyAdapterRuntime`);
    result.push({ key, runtime });
  }
  return result;
}

/**
 * `options.runtime` selects exactly that one entry — no cascading into its
 * `dependsOn` (a runtime that needs another already up fails fast, same as
 * today). Omitted, every entry runs in `dependsOn` order (reversed for `down`).
 * `up` stops at the first failure; `down` is best-effort across every entry.
 */
export async function runConfiguredRuntime(path: string, action: "up" | "down", options: ConfiguredRuntimeOptions = {}): Promise<void> {
  const plugins = await loadConfiguredRuntimes(path, options);
  if (action === "up") {
    for (const { key, runtime } of plugins) {
      try { await runtime.up(); }
      catch (error) { throw new Error(`runtimes.${key}: ${error instanceof Error ? error.message : "failed to start"}`); }
    }
    return;
  }
  const errors: string[] = [];
  for (const { key, runtime } of [...plugins].reverse()) {
    if (!runtime.down) continue;
    try { await runtime.down(); }
    catch (error) { errors.push(`runtimes.${key}: ${error instanceof Error ? error.message : "failed to stop"}`); }
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

export async function validateConfiguredTests(path: string, options: ConfiguredTestsOptions = {}): Promise<{ tests: readonly string[] }> {
  return { tests: (await prepare(path, options)).tests.map((test) => test.id) };
}

export async function runConfiguredTests(path: string, options: ConfiguredTestsOptions = {}): Promise<ConfiguredTestsResult> {
  // Prepare every selected test before the first environment setup.
  const prepared = await prepare(path, options);
  const tests: ConfiguredTestResult[] = [];
  for (const test of prepared.tests) {
    if (options.signal?.aborted) break;
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason ?? new Error("Journey test interrupted"));
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`Test ${test.id} exceeded its ${test.timeoutMs}ms timeout`)), test.timeoutMs);
    let result: RunResult;
    try {
      result = await runJourney({ plan: test.plan, adapter: test.adapter, profiles: test.profiles, environment: test.environment,
        signal: controller.signal, progress: options.progress });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
    const reporting = await reportJourneyResult({ result, reporters: [
      { name: "journey-mesh/evidence", async report({ json }) { await test.artifacts.write({ name: "ujg-evidence.json", data: json, contentType: "application/json" }); } },
      ...test.reporters
    ] });
    const errors = [...reporting.errors];
    try {
      await test.artifacts.write({ name: "ujg-summary.json", data: JSON.stringify({ testId: test.id, result, reportingErrors: errors, artifacts: test.artifacts.files }, null, 2), contentType: "application/json" });
      await test.artifacts.write({ name: "index.html", data: testHtml(test.id, result, errors, test.artifacts), contentType: "text/html" });
    } catch (error) { errors.push(errorToJourneyRunError(error)); }
    tests.push({ id: test.id, result, reportingErrors: Object.freeze(errors), artifacts: test.artifacts.files });
  }
  const ok = tests.length === prepared.tests.length && tests.every((test) => test.result.ok && test.reportingErrors.length === 0);
  await mkdir(prepared.outputDir, { recursive: true });
  await writeFile(resolve(prepared.outputDir, "index.html"), suiteHtml(tests), "utf8");
  await writeFile(resolve(prepared.outputDir, "journey-results.json"), JSON.stringify({ ok, tests }, null, 2));
  return { ok, outputDir: prepared.outputDir, tests };
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{font:16px/1.55 system-ui;max-width:960px;margin:3rem auto;padding:0 1.5rem;color:#182524}a{color:#09645d}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f5f4;padding:1rem}li{margin:.35rem 0}</style><h1>${escapeHtml(title)}</h1>${body}</html>`;
}
function testHtml(id: string, result: RunResult, errors: readonly JourneyRunError[], store: JourneyArtifactStore): string {
  const summary = renderJourneyRunSummary({ result }, { color: "never" });
  return page(id, `<p>${result.ok && !errors.length ? "Passed" : "Failed"}</p><pre>${escapeHtml(summary)}</pre>${errors.map((error) => `<pre>${escapeHtml(error.message)}</pre>`).join("")}<h2>Artifacts</h2><ul>${store.files.map((file) => `<li><a href="${escapeHtml(file.href.split("/").map(encodeURIComponent).join("/"))}">${escapeHtml(file.name)}</a></li>`).join("")}</ul>`);
}
function suiteHtml(tests: readonly ConfiguredTestResult[]): string {
  return page("Journey Mesh tests", `<ul>${tests.map((test) => `<li><a href="${encodeURIComponent(testDirectory(test.id))}/index.html">${escapeHtml(test.id)}</a> — ${test.result.ok && !test.reportingErrors.length ? "passed" : "failed"}</li>`).join("")}</ul>`);
}

function testDirectory(id: string): string { return encodeURIComponent(id).replace(/\./g, "%2E"); }
