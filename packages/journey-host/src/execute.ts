import { immutableSnapshot, type JourneyObserverOutput } from "@openuji/journey-core";
import type { JourneyArtifactStore, JourneyObserverComponent, JourneyReporter, JourneyService, SuiteResultBundle, TestResultBundle } from "@openuji/journey-plugin";
import { reportJourneyResult, testPassed, writeReport } from "@openuji/journey-reporter";
import { errorToJourneyRunError, runJourney, type JourneyProgressSink, type JourneyRunError, type RunResult } from "@openuji/journey-runner";
import type { AssembledTest } from "./assemble.js";
import type { LoadedService } from "./services.js";

/** A suite ready to run: every selected test passed preflight and no resource has been allocated. */
export type PreparedSuite = Readonly<{
  label?: string;
  outputDir: string;
  tests: readonly AssembledTest[];
  /** Services the selected tests need, dependencies first. */
  services: readonly LoadedService[];
  reporters: readonly JourneyReporter[];
  artifacts: JourneyArtifactStore;
}>;
export type ExecuteOptions = { signal?: AbortSignal; progress?: readonly JourneyProgressSink[] };

/**
 * Ask every observer for its output and check it against the run. An invalid or failing output is a
 * reporting error of the test; it never changes the execution result.
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
      outputs.push(output);
    } catch (error) { errors.push(errorToJourneyRunError(error)); }
  }
  return { outputs, errors };
}

async function executeTest(test: AssembledTest, options: ExecuteOptions): Promise<TestResultBundle> {
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
  const bundle: TestResultBundle = immutableSnapshot({ kind: "test", id: test.id, plan: test.plan, result, outputs, reportingErrors: errors, artifacts: test.artifacts.files });
  errors.push(...await reportJourneyResult({ bundle, reporters: test.reporters, artifacts: test.artifacts }));
  return immutableSnapshot({ ...bundle, reportingErrors: errors, artifacts: test.artifacts.files });
}

/**
 * Start the services, run every test in order, stop the services (also after failures and
 * cancellation), then report and write the suite bundle once.
 */
export async function executeSuite(prepared: PreparedSuite, options: ExecuteOptions = {}): Promise<SuiteResultBundle> {
  const tests: TestResultBundle[] = [];
  const errors: JourneyRunError[] = [];
  const started: JourneyService[] = [];
  let ready = true;
  try {
    for (const { service } of prepared.services) {
      options.signal?.throwIfAborted();
      // Include partially started services in cleanup.
      started.push(service);
      await service.up({ signal: options.signal });
      options.signal?.throwIfAborted();
    }
  } catch (error) { ready = false; errors.push(errorToJourneyRunError(error)); }
  try {
    for (const test of prepared.tests) {
      if (!ready || options.signal?.aborted) break;
      tests.push(await executeTest(test, options));
    }
  } catch (error) { errors.push(errorToJourneyRunError(error)); }
  finally {
    for (const service of [...started].reverse()) try { await service.down?.(); } catch (error) { errors.push(errorToJourneyRunError(error)); }
  }
  // Service stores live below the suite root, so their hrefs are already suite-relative.
  const artifacts = () => [...prepared.artifacts.files, ...prepared.services.flatMap((service) => service.artifacts.files)];
  const provenance = Object.fromEntries(prepared.services.filter(({ service }) => service.provenance).map(({ key, service }) => [key, service.provenance!()]));
  if (options.signal?.aborted) errors.push(errorToJourneyRunError(options.signal.reason ?? new Error("Suite cancelled")));
  const ok = !errors.length && !options.signal?.aborted && tests.length === prepared.tests.length && tests.every(testPassed);
  const draft: SuiteResultBundle = immutableSnapshot({
    kind: "suite", ...(prepared.label ? { label: prepared.label } : {}), ok, generatedAt: new Date().toISOString(),
    tests, errors, provenance, artifacts: artifacts()
  });
  errors.push(...await reportJourneyResult({ bundle: draft, reporters: prepared.reporters, artifacts: prepared.artifacts }));
  const bundle: SuiteResultBundle = immutableSnapshot({ ...draft, ok: ok && !errors.length, errors, artifacts: artifacts() });
  await writeReport(prepared.outputDir, bundle);
  return bundle;
}
