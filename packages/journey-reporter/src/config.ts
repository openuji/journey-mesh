import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { optionsObject, requiredString, stringArray } from "@openuji/journey-plugin";
import type { InterpreterDefinition } from "./interpreter.js";

export type InterpreterConfig = Readonly<{ use: string; options: Readonly<Record<string, unknown>> }>;
/**
 * The `report` sections of a suite configuration. The host accepts these keys but never reads them;
 * this layer owns their meaning.
 */
export type ReportConfig = Readonly<{
  /** The configuration file; relative `use` references resolve from its directory. */
  configPath?: string;
  interpreters: readonly InterpreterConfig[];
  excludedPhaseIds: readonly string[];
  /** Per-test overrides. */
  tests: Readonly<Record<string, Readonly<{ excludedPhaseIds: readonly string[] }>>>;
}>;

export const defaultReportConfig: ReportConfig = Object.freeze({ interpreters: [], excludedPhaseIds: [], tests: {} });

const known = (value: Record<string, unknown>, keys: readonly string[], label: string) => {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unknown setting ${label}.${key}`);
};

/** Parse the reporting part of a whole suite configuration object. Unknown report settings are rejected. */
export function parseReportConfig(raw: Record<string, unknown>, configPath?: string): ReportConfig {
  const report = raw.report === undefined ? {} : optionsObject(raw.report, "report");
  known(report, ["interpreters", "excludedPhaseIds"], "report");
  const interpreters = report.interpreters === undefined ? [] : (Array.isArray(report.interpreters) ? report.interpreters : (() => { throw new Error("report.interpreters must be an array"); })())
    .map((item: unknown, index: number): InterpreterConfig => {
      const label = `report.interpreters[${index}]`;
      const entry = optionsObject(item, label);
      known(entry, ["use", "options"], label);
      return { use: requiredString(entry.use, `${label}.use`), options: optionsObject(entry.options ?? {}, `${label}.options`) };
    });
  const tests: Record<string, { excludedPhaseIds: readonly string[] }> = {};
  for (const [id, value] of Object.entries(raw.tests === undefined ? {} : optionsObject(raw.tests, "tests"))) {
    const test = value && typeof value === "object" ? (value as Record<string, unknown>).report : undefined;
    if (test === undefined) continue;
    const settings = optionsObject(test, `tests.${id}.report`);
    known(settings, ["excludedPhaseIds"], `tests.${id}.report`);
    tests[id] = { excludedPhaseIds: settings.excludedPhaseIds === undefined ? [] : stringArray(settings.excludedPhaseIds, `tests.${id}.report.excludedPhaseIds`) };
  }
  return Object.freeze({
    ...(configPath ? { configPath } : {}),
    interpreters,
    excludedPhaseIds: report.excludedPhaseIds === undefined ? [] : stringArray(report.excludedPhaseIds, "report.excludedPhaseIds"),
    tests
  });
}

/** Read the `report` sections of a suite configuration file. */
export async function loadReportConfig(configPath: string): Promise<ReportConfig> {
  const path = resolve(configPath);
  const raw = parse(await readFile(path, "utf8")) as unknown;
  return parseReportConfig(optionsObject(raw ?? {}, "configuration"), path);
}

/** A test's own exclusions replace the suite's. */
export function excludedPhasesFor(config: ReportConfig, testId: string): readonly string[] {
  return config.tests[testId]?.excludedPhaseIds ?? config.excludedPhaseIds;
}

export type LoadedInterpreter = Readonly<{ use: string; definition: InterpreterDefinition; settings: unknown }>;

/** Import every configured interpreter module and validate its options. */
export async function loadInterpreters(config: ReportConfig): Promise<readonly LoadedInterpreter[]> {
  const base = config.configPath ?? resolve(process.cwd(), "journey-report.config");
  const loaded: LoadedInterpreter[] = [];
  for (const [index, entry] of config.interpreters.entries()) {
    const label = `report.interpreters[${index}]`;
    const modulePath = entry.use.startsWith(".") || entry.use.startsWith("/") ? resolve(dirname(base), entry.use) : createRequire(base).resolve(entry.use);
    const module = await import(pathToFileURL(modulePath).href) as { journeyMeshInterpreter?: InterpreterDefinition };
    const definition = module.journeyMeshInterpreter;
    if (!definition || typeof definition.kind !== "string" || !definition.kind || typeof definition.interpret !== "function") {
      throw new Error(`${label}: ${entry.use} must export journeyMeshInterpreter with a kind and interpret()`);
    }
    let settings: unknown;
    try { settings = definition.parse ? definition.parse({ ...entry.options }) : entry.options; }
    catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : "invalid options"}`); }
    loaded.push({ use: entry.use, definition, settings });
  }
  return loaded;
}
