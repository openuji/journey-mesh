import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadSuiteRun, testDirectory, validateHref, type TestRecord } from "@openuji/journey-run-record";
import { publishAtomically, runDirectory, runReader } from "@openuji/journey-run-record/node";
import { defaultReportConfig, excludedPhasesFor, loadInterpreters, type LoadedInterpreter, type ReportConfig } from "./config.js";
import type { InterpreterInput, NodeSummary } from "./interpreter.js";
import { buildReportModel, buildTestModel, testModelHref, type Interpreted } from "./model/build.js";
import type { DataRef, ReportError, ReportModel, TestModel, ViewRef } from "./model/types.js";

export type BuildReportOptions = Readonly<{ config?: ReportConfig; generatedAt?: string }>;
export type BuiltReport = Readonly<{ model: ReportModel; tests: readonly TestModel[] }>;

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Writes JSON files below the staging copy of `report/`; hrefs stay relative to the run directory. */
function reportWriter(staging: string) {
  return async (href: string, value: unknown) => {
    validateHref(href);
    if (!href.startsWith("report/")) throw new Error(`Report files belong below report/: ${href}`);
    const path = resolve(staging, href.slice("report/".length));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value));
  };
}

async function interpret(test: TestRecord, interpreters: readonly LoadedInterpreter[], input: Omit<InterpreterInput, "test" | "output">,
  write: (href: string, value: unknown) => Promise<void>, errors: ReportError[]): Promise<Interpreted[]> {
  const results: Interpreted[] = [];
  for (const output of test.observers) {
    for (const interpreter of interpreters.filter((item) => item.definition.kind === output.kind)) {
      try {
        const result = await interpreter.definition.interpret({ ...input, test, output }, interpreter.settings);
        const executions = new Set(test.result.executions.map((execution) => execution.executionId));
        const nodes: NodeSummary[] = [];
        for (const node of result.nodes ?? []) {
          if (!executions.has(node.executionId) || typeof node.operationId !== "string" || typeof node.metrics?.kind !== "string") throw new Error(`Invalid node metrics for ${String(node.operationId)}`);
          nodes.push(node);
        }
        const data: DataRef[] = [];
        for (const item of result.data ?? []) {
          validateHref(item.name);
          if (typeof item.format !== "string" || !item.format) throw new Error(`Derived data ${item.name} needs a format`);
          const href = `report/data/${testDirectory(test.id)}/${encodeURIComponent(output.id)}/${item.name}`;
          await write(href, item.value);
          data.push({ href, name: item.name, format: item.format, ...(item.label ? { label: item.label } : {}), observer: output.id });
        }
        results.push({ observer: output.id, nodes, data });
      } catch (error) {
        errors.push({ name: "InterpreterError", message: `${interpreter.use} could not interpret observer ${output.id}: ${message(error)}`, test: test.id });
      }
    }
  }
  return results;
}

/**
 * Derive `report/` of a run directory from its run record: interpret observer evidence, join it with
 * the plan and execution results, and write the report model. The run record is never changed, and
 * problems become report errors instead of failing tests. The previous `report/` is replaced atomically.
 */
export async function buildReport(path: string, options: BuildReportOptions = {}): Promise<BuiltReport> {
  const directory = await runDirectory(path);
  const read = runReader(directory);
  const run = await loadSuiteRun(read);
  const config = options.config ?? defaultReportConfig;
  const interpreters = await loadInterpreters(config);
  const readJson = async <T>(href: string) => JSON.parse(new TextDecoder().decode(await read(href))) as T;
  return publishAtomically(resolve(directory, "report"), [], async (staging) => {
    const write = reportWriter(staging);
    const errors: ReportError[] = [];
    const viewHrefs = new Map<string, string>();
    const tests: TestModel[] = [];
    for (const test of run.tests) {
      const excludedPhaseIds = excludedPhasesFor(config, test.id);
      const interpreted = await interpret(test, interpreters, { read, readJson, excludedPhaseIds }, write, errors);
      const views: Record<string, ViewRef> = {};
      for (const [key, view] of Object.entries(test.views)) {
        const hash = createHash("sha256").update(JSON.stringify(view)).digest("hex");
        if (!viewHrefs.has(hash)) { viewHrefs.set(hash, `report/views/${hash}.json`); await write(viewHrefs.get(hash)!, view); }
        views[key] = { href: viewHrefs.get(hash)!, format: view.format };
      }
      const model = buildTestModel({ test, excludedPhaseIds, views, interpreted });
      errors.push(...model.mapErrors.map((item) => ({ name: "JourneyMapError", message: item, test: test.id })));
      await write(testModelHref(test.id), model);
      tests.push(model);
    }
    const model = buildReportModel({ run, tests, errors, generatedAt: options.generatedAt ?? new Date().toISOString() });
    await write("report/report.json", model);
    return { model, tests };
  });
}
