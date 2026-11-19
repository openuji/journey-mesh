import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testRecordFormat, type EvidenceFile, type SuiteRun, type TestRecord } from "@openuji/journey-run-record";
import { writeRunRecord } from "@openuji/journey-run-record/node";
import { parseReportConfig, type ReportConfig } from "../src/index.js";

export const nodeInterpreter = fileURLToPath(new URL("./fixtures/node-interpreter.mjs", import.meta.url));

/** A manual plan with two occurrences of one state: the first passed with a screenshot, the second failed. */
export function savedTest(): TestRecord {
  const base = { actorId: "actor", touchpointId: "app", entry: { id: "entry", stateId: "same-source-state" }, segment: "task" };
  const operation = (id: string, label: string, sequence: number) => ({ ...base, id, sequence, kind: "state" as const, state: { id: "same-source-state", label }, surface: { id: "surface" }, target: { bindings: [], expectedMatchCount: 0, observation: { stateId: "same-source-state", surfaceId: "surface", bindings: [], expectedMatchCount: 0 } } });
  return { format: testRecordFormat, version: 1, id: "manual-plan", ok: false, segments: [], views: {}, plan: { id: "manual", operations: [operation("first-occurrence", "Arrival", 0), operation("second-occurrence", "Completion", 1)] },
    result: { ok: false, runId: "run", plan: { id: "manual" }, errors: [{ name: "Error", message: "Failure" }], assessments: [{ kind: "applicable", profile: { id: "keyboard" } }], executions: [{ executionId: "execution", profileId: "keyboard", outcome: { kind: "failed", error: { name: "Error", message: "Failure" } } }], evidence: { executions: [{ executionId: "execution", profileId: "keyboard", operations: [{ operationId: "first-occurrence", operationKind: "state", outcome: { kind: "passed" } }, { operationId: "second-occurrence", operationKind: "state", outcome: { kind: "failed", error: { name: "Error", message: "Completion failed" } } }] }] } },
    observers: [], observerErrors: [], files: [
      { name: "right.png", href: "tests/manual-plan/files/right.png", contentType: "image/png", scope: { runId: "run", executionId: "execution", profileId: "keyboard", operationId: "first-occurrence" } },
      { name: "wrong.png", href: "tests/manual-plan/files/wrong.png", contentType: "image/png", scope: { runId: "old-run", executionId: "execution", profileId: "keyboard", operationId: "second-occurrence" } }
    ] };
}

export function suiteRun(tests: readonly TestRecord[], overrides: Partial<SuiteRun> = {}): SuiteRun {
  return { ok: tests.every((test) => test.ok), startedAt: "2026-11-19T10:00:00.000Z", finishedAt: "2026-11-19T10:01:00.000Z", errors: [], provenance: {}, files: [], tests, ...overrides };
}

/** Write a run directory: placeholder bytes for every registered file, then the records. */
export async function writeRun(directory: string, run: SuiteRun, content: (file: EvidenceFile) => string | Uint8Array = () => new Uint8Array()): Promise<string> {
  for (const file of [...run.files, ...run.tests.flatMap((test) => test.files)]) {
    await mkdir(dirname(join(directory, file.href)), { recursive: true });
    await writeFile(join(directory, file.href), content(file));
  }
  await writeRunRecord(directory, run);
  return directory;
}

export const fixtureConfig = (report: Record<string, unknown> = {}, tests: Record<string, unknown> = {}): ReportConfig =>
  parseReportConfig({ report: { interpreters: [{ use: nodeInterpreter }], ...report }, tests });
