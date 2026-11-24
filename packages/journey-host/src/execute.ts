import { sourceIdentity } from "@openuji/journey-plugin";
import { startService, serviceOutputs } from "./services.js";
import type { ServiceOutputRef } from "./config/schema.js";
import { immutableSnapshot, type JourneyObserverOutput } from "@openuji/journey-core";
import type { JourneyArtifactStore, JourneyObserverComponent } from "@openuji/journey-plugin";
import { testPassed, testRecordFormat, type SuiteRun, type TestRecord } from "@openuji/journey-run-record";
import { writeRunRecord } from "@openuji/journey-run-record/node";
import { errorToJourneyRunError, runJourney, type JourneyProgressSink, type JourneyRunError, type RunResult } from "@openuji/journey-runner";
import { assembleTest, type AssembledTest, type PreparedTest } from "./assemble.js";
import type { LoadedService, ActiveService } from "./services.js";
import { pluginLoader } from "./plugins/loader.js";
import { fileEvidenceStore } from "@openuji/journey-run-record/node";
import { testFilesPrefix, serviceFilesPrefix } from "@openuji/journey-run-record";
import type { LoadedSuiteConfig } from "./config/load.js";
import type { ServiceValues } from "./inputs.js";
import type { LoadedPlugin } from "./plugins/loader.js";
import { runtimeObservers } from "./runtime-observers.js";
import type { SuiteDiscovery } from "./discovery.js";

/** A suite ready to run: every selected test passed preflight and no resource has been allocated. */
export type PreparedSuite = Readonly<{
  label?: string;
  target?: ServiceOutputRef;
  outputDir: string;
  tests: readonly PreparedTest[];
  /** Services the selected tests need, dependencies first. */
  services: readonly LoadedService[];
  runtimeObservers?: readonly LoadedPlugin<"runtime-observer">[];
  loaded: LoadedSuiteConfig;
  /** Set when the suite was prepared as a discovery run; its adapters run in discovery mode. */
  discovery?: SuiteDiscovery;
}>;
export type ExecuteOptions = { signal?: AbortSignal; progress?: readonly JourneyProgressSink[]; outputDir?: string };

/**
 * Ask every observer for its output and check it against the run. Only the contract fields are kept.
 * An invalid or failing output is an observer error of the test; it never changes the execution result.
 */
export async function collectObserverOutputs(observers: readonly JourneyObserverComponent[], result: RunResult): Promise<{ outputs: JourneyObserverOutput[]; errors: JourneyRunError[] }> {
  const outputs: JourneyObserverOutput[] = [];
  const errors: JourneyRunError[] = [];
  for (const observer of observers) {
    try {
      const output = immutableSnapshot(await observer.output({ result }));
      if (!output || typeof output.id !== "string" || typeof output.kind !== "string" || !Array.isArray(output.measurements) || !Array.isArray(output.errors)) throw new Error("Invalid observer output");
      if (outputs.some((item) => item.id === output.id)) throw new Error(`Duplicate observer output ${output.id}`);
      const keys = new Set<string>();
      for (const metric of output.measurements) {
        const key = JSON.stringify([metric.id, metric.scope.executionId]);
        if (keys.has(key)) throw new Error(`Duplicate measurement ${metric.id}`);
        keys.add(key);
        if (metric.scope.runId !== result.runId || !result.executions.some((execution) => execution.executionId === metric.scope.executionId && execution.profileId === metric.scope.profileId)) throw new Error(`Measurement ${metric.id} does not match the execution`);
        if (typeof metric.value === "number" && !Number.isFinite(metric.value)) throw new Error("Measurements must be finite");
      }
      outputs.push(immutableSnapshot({ id: output.id, kind: output.kind, measurements: output.measurements, evidence: output.evidence, errors: output.errors }));
    } catch (error) { errors.push(errorToJourneyRunError(error)); }
  }
  return { outputs, errors };
}

/** The journeys of a test and the model snapshot of each, recorded so consumers need no model or source files. */
function journeySegments(test: AssembledTest): Pick<TestRecord, "segments" | "views"> {
  return {
    views: Object.fromEntries(test.compiled.views),
    segments: [...test.compiled.segments.values()].map((segment) => ({
      id: segment.id, journeyId: segment.journeyId, adapter: segment.adapter, ...(test.compiled.views.has(segment.source) ? { view: segment.source } : {})
    }))
  };
}

async function executeTest(test: AssembledTest, options: ExecuteOptions): Promise<TestRecord> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason ?? new Error("Journey test interrupted"));
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`Test ${test.id} exceeded its ${test.timeoutMs}ms timeout`)), test.timeoutMs);
  let result: RunResult;
  try {
    result = await runJourney({ plan: test.plan, adapter: test.adapter, profiles: test.profiles, environment: test.environment, signal: controller.signal, progress: options.progress });
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
  }
  const { outputs, errors } = await collectObserverOutputs(test.observers, result);
  const verdict = { result, observers: outputs, observerErrors: errors };
  return immutableSnapshot({ format: testRecordFormat, version: 1, id: test.id, ok: testPassed(verdict), ...journeySegments(test),
    plan: test.plan, ...verdict, files: test.artifacts.files });
}

/**
 * Start the services, run every test in order, stop the services (also after failures and
 * cancellation), then write the run record once. Nothing here derives reports.
 */
export async function executeSuite(prepared: PreparedSuite, options: ExecuteOptions = {}): Promise<SuiteRun> {
  const startedAt = new Date().toISOString();
  const tests: TestRecord[] = [];
  const errors: JourneyRunError[] = [];
  let active: readonly ActiveService[] = Object.freeze([]);
  let attempts: readonly JourneyArtifactStore[] = Object.freeze([]);
  let provenance: Readonly<Record<string, unknown>> = Object.freeze({});
  let values: ServiceValues = Object.freeze({});
  const outputDir = options.outputDir ?? prepared.outputDir;
  const observation = runtimeObservers(prepared.loaded, prepared.runtimeObservers ?? [], outputDir);
  let runtimeTests: readonly AssembledTest[] = Object.freeze([]);
  let target: SuiteRun["target"];
  let ready = true;
  try {
    await observation.start();
    for (const entry of prepared.services) {
      options.signal?.throwIfAborted();
      const artifacts = fileEvidenceStore(outputDir, serviceFilesPrefix(entry.key));
      attempts = [...attempts, artifacts];
      const acquired = await startService(entry, prepared.loaded, values, outputDir, options.signal, artifacts, observation.observable.publisher(`services.${entry.key}`));
      active = [...active, acquired];
      values = Object.freeze({ ...values, [entry.key]: serviceOutputs(entry, acquired.lease) });
      if (acquired.lease.provenance !== undefined) provenance = Object.freeze({ ...provenance, [entry.key]: immutableSnapshot(acquired.lease.provenance) });
      options.signal?.throwIfAborted();
    }
    if (prepared.target) target = sourceIdentity(values[prepared.target.service]?.[prepared.target.output]);
    const load = pluginLoader(prepared.loaded.path, prepared.loaded.env);
    for (const test of prepared.tests) runtimeTests = [...runtimeTests, await assembleTest(test.config, test.compiled, {
      loaded: prepared.loaded, load, values, artifacts: fileEvidenceStore(outputDir, testFilesPrefix(test.id)), observations: observation.observable,
      ...(prepared.discovery ? { discovery: prepared.discovery } : {})
    })];
  } catch (error) { ready = false; errors.push(errorToJourneyRunError(error)); }
  try {
    for (const test of runtimeTests) {
      if (!ready || options.signal?.aborted) break;
      tests.push(await executeTest(test, options));
    }
  } catch (error) { errors.push(errorToJourneyRunError(error)); }
  finally {
    for (const service of [...active].reverse()) try { await service.lease.release(); } catch (error) { errors.push(errorToJourneyRunError(error)); }
    try { await observation.close(); } catch (error) { errors.push(errorToJourneyRunError(error)); }
  }
  // Service stores live below the run directory, so their hrefs are already run-relative.
  const files = [...attempts.flatMap((artifacts) => artifacts.files), ...observation.files];
  if (options.signal?.aborted) errors.push(errorToJourneyRunError(options.signal.reason ?? new Error("Suite cancelled")));
  const ok = !errors.length && !options.signal?.aborted && tests.length === prepared.tests.length && tests.every((test) => test.ok);
  const run: SuiteRun = immutableSnapshot({
    ...(prepared.label ? { label: prepared.label } : {}), ...(target ? { target } : {}), ok,
    startedAt, finishedAt: new Date().toISOString(), errors, provenance, files, tests
  });
  await writeRunRecord(outputDir, run);
  return run;
}
