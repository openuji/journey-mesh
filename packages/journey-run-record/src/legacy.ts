import type { RunRecord, TestRecord } from "./types.js";

/**
 * Format version 1 called the component that executed an operation an "adapter". The reader
 * normalizes version-1 records in memory, so interpreters, observers and the reporter only ever
 * see version-2 shapes and current component names. This module is the only place the legacy
 * names live.
 */
const legacyComponentNames: Readonly<Record<string, string>> = Object.freeze({
  "@openuji/journey-adapter-playwright": "@openuji/journey-executor-playwright",
  "@openuji/journey-adapter-appium": "@openuji/journey-executor-appium",
  "@openuji/journey-runner/routed-adapter": "@openuji/journey-runner/routed-executor",
  "@openuji/journey-runner/touchpoint-adapter": "@openuji/journey-runner/touchpoint-executor"
});

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);

/** Rename `from` to `to` in place of the original key, so key order (and serialized output) is preserved. */
function renameKey(value: Json, from: string, to: string, convert: (item: unknown) => unknown = (item) => item): Json {
  if (!Object.hasOwn(value, from)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => key === from ? [to, convert(item)] : [key, item]));
}

const component = (value: unknown): unknown => {
  if (!isObject(value) || typeof value.name !== "string") return value;
  const name = legacyComponentNames[value.name];
  return name ? { ...value, name } : value;
};

function normalizeResult(result: unknown): unknown {
  if (!isObject(result) || !isObject(result.evidence) || !Array.isArray(result.evidence.executions)) return result;
  const executions = result.evidence.executions.map((execution: unknown) => {
    if (!isObject(execution) || !Array.isArray(execution.operations)) return execution;
    return { ...execution, operations: execution.operations.map((operation: unknown) => isObject(operation) ? renameKey(operation, "adapter", "executor", component) : operation) };
  });
  return { ...result, evidence: { ...result.evidence, executions } };
}

/** A version-1 test record as version 2: `adapter` fields become `executor`, legacy component names current ones. */
export function normalizeV1Test(test: unknown): TestRecord {
  const record = test as Json;
  const segments = Array.isArray(record.segments)
    ? record.segments.map((segment: unknown) => isObject(segment) ? renameKey(segment, "adapter", "executor") : segment)
    : record.segments;
  return { ...record, version: 2, segments, result: normalizeResult(record.result) } as unknown as TestRecord;
}

/** A version-1 run index as version 2. The index itself names no executing component. */
export function normalizeV1Run(run: unknown): RunRecord {
  return { ...(run as Json), version: 2 } as unknown as RunRecord;
}
