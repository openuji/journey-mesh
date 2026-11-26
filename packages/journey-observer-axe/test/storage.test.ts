import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executionDescriptor, type JourneyPlan, type RunResult } from "@openuji/journey-runner";
import { fileEvidenceStore } from "@openuji/journey-run-record/node";
import { axeAuditFormat, axeObserver } from "../src/index.js";
import { buildAxeAuditReport } from "../src/audit/audit-report.js";
import type { AxeAuditReport, AxeResults } from "../src/types.js";

test("308 audits are captured once as raw evidence files; the recorded output stays small and references them", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "axe-storage-scale-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifacts = fileEvidenceStore(directory, "tests/scale/files");
  const operations = Array.from({ length: 154 }, (_, index) => ({
    id: `state-${index}`, sequence: index, kind: "state" as const, actorId: "actor", touchpointId: "app",
    entry: { id: "entry", stateId: "state-0" }, state: { id: `state-${index}` }, surface: { id: "surface" },
    target: { expectedMatchCount: 1, bindings: [], observation: { stateId: `state-${index}`, surfaceId: "surface", expectedMatchCount: 1, bindings: [] } }
  }));
  const plan: JourneyPlan = { id: "scale-plan", operations };
  const profiles = ["default", "keyboard"];
  let scanIndex = 0;
  const scan = (): AxeResults => {
    const id = scanIndex++;
    return { url: "https://example.test/", violations: [], incomplete: [], inapplicable: [],
      passes: [{ id: "pass-rule", nodes: Array.from({ length: id < 132 ? 248 : 249 }, (_, index) => ({
        target: [`#node-${index}`], html: `<div data-proof="raw-only-${id}-${index}">${"evidence ".repeat(50)}</div>`, any: [], all: [], none: []
      })) }] } as unknown as AxeResults;
  };
  const observer = axeObserver({ artifacts, reportId: "scale-audits", auditRunner: async (input) => buildAxeAuditReport({
    auditId: input.auditId, metadata: input.metadata, url: "https://example.test/", createdAt: "now", strict: false
  }, [], { pageState: scan(), matchedSurface: scan() }) });
  for (const profile of profiles) {
    const execution = executionDescriptor({ plan, profile: { id: profile }, runId: "scale", executionId: profile });
    observer.onExecutionStarted!({ execution });
    for (const operation of operations) await observer.observeOperation!({ stage: "state-asserted", execution, operation,
      expectedMatchCount: 1, locator: {} as never, page: {} as never });
  }
  const result: RunResult = { ok: true, runId: "scale", plan: { id: plan.id }, errors: [],
    assessments: profiles.map((id) => ({ kind: "applicable", profile: { id } })),
    executions: profiles.map((id) => ({ executionId: id, profileId: id, outcome: { kind: "passed" } })),
    evidence: { executions: profiles.map((id) => ({ executionId: id, profileId: id, operations: operations.map((operation) => ({ operationId: operation.id, operationKind: "state", outcome: { kind: "passed" } })) })) }
  };
  const output = observer.output(result);
  assert.equal(scanIndex, 616);
  assert.doesNotMatch(JSON.stringify(output), /raw-only-/);
  assert.ok(JSON.stringify(output).length < 1024 * 1024);
  const rawAudits = artifacts.files.filter((file) => file.format === axeAuditFormat);
  assert.equal(rawAudits.length, 308, "capture persists raw audits without any reporting");
  assert.ok(rawAudits.every((file) => file.href.startsWith("tests/scale/files/") && file.scope?.operationId));
  const raw = JSON.parse(await readFile(join(directory, rawAudits[0].href), "utf8")) as AxeAuditReport;
  assert.equal(raw.scans.pageState.passes[0].nodes.length, 248);
  assert.match(raw.scans.pageState.passes[0].nodes[0].html, /raw-only-0-0/);
  let passingNodes = 0;
  for (const file of rawAudits) passingNodes += ((await readFile(join(directory, file.href), "utf8")).match(/raw-only-/g) ?? []).length;
  assert.equal(passingNodes, 153_252);
});

test("an operation observed again, as a transition taken through its fallback is, is audited once", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "axe-repeated-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const operation = { id: "state", sequence: 0, kind: "state" as const, actorId: "actor", touchpointId: "app",
    entry: { id: "entry", stateId: "state" }, state: { id: "state" }, surface: { id: "surface" },
    target: { expectedMatchCount: 1, bindings: [], observation: { stateId: "state", surfaceId: "surface", expectedMatchCount: 1, bindings: [] } } };
  const plan: JourneyPlan = { id: "repeated", operations: [operation] };
  const violation = { id: "rule", nodes: [{ target: ["#a"], html: "<a>", any: [], all: [], none: [] }] };
  const scan = () => ({ url: "https://example.test/", violations: [violation], incomplete: [], inapplicable: [], passes: [] }) as unknown as AxeResults;
  const observer = axeObserver({ artifacts: fileEvidenceStore(directory, "tests/repeated/files"), reportId: "audits", auditRunner: async (input) => buildAxeAuditReport({
    auditId: input.auditId, metadata: input.metadata, url: "https://example.test/", createdAt: "now", strict: false
  }, [], { pageState: scan(), matchedSurface: scan() }) });
  const execution = executionDescriptor({ plan, profile: { id: "default" }, runId: "repeated", executionId: "default" });
  observer.onExecutionStarted!({ execution });
  for (let attempt = 0; attempt < 2; attempt++) await observer.observeOperation!({ stage: "state-asserted", execution, operation, expectedMatchCount: 1, locator: {} as never, page: {} as never });
  assert.equal(observer.evidence.filter((fact) => fact.kind === "operation-observed").length, 1);
  const output = observer.output({ ok: true, runId: "repeated", plan: { id: plan.id }, errors: [], assessments: [],
    executions: [{ executionId: "default", profileId: "default", outcome: { kind: "passed" } }],
    evidence: { executions: [{ executionId: "default", profileId: "default", operations: [{ operationId: "state", operationKind: "state", outcome: { kind: "passed" } }] }] } });
  assert.equal(output.measurements.find((metric) => metric.id === "axe/pageState/violations")?.value, 1);
});

test("a failed audit leaves the counts partial, also when the execution went on and passed", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "axe-missing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const operations = [0, 1].map((index) => ({ id: `state-${index}`, sequence: index, kind: "state" as const, actorId: "actor", touchpointId: "app",
    entry: { id: "entry", stateId: "state-0" }, state: { id: `state-${index}` }, surface: { id: "surface" },
    target: { expectedMatchCount: 1, bindings: [], observation: { stateId: `state-${index}`, surfaceId: "surface", expectedMatchCount: 1, bindings: [] } } }));
  const plan: JourneyPlan = { id: "missing", operations };
  const scan = () => ({ url: "https://example.test/", violations: [], incomplete: [], inapplicable: [], passes: [] }) as unknown as AxeResults;
  let audits = 0;
  const observer = axeObserver({ artifacts: fileEvidenceStore(directory, "tests/missing/files"), reportId: "audits", auditRunner: async (input) => {
    if (audits++ === 1) throw new Error("axe timed out");
    return buildAxeAuditReport({ auditId: input.auditId, metadata: input.metadata, url: "https://example.test/", createdAt: "now", strict: false }, [], { pageState: scan(), matchedSurface: scan() });
  } });
  const execution = executionDescriptor({ plan, profile: { id: "default" }, runId: "missing", executionId: "default" });
  observer.onExecutionStarted!({ execution });
  const observe = async (index: number) => observer.observeOperation!({ stage: "state-asserted", execution, operation: operations[index]!, expectedMatchCount: 1, locator: {} as never, page: {} as never });
  await observe(0);
  await assert.rejects(observe(1), /axe timed out/);
  const output = observer.output({ ok: true, runId: "missing", plan: { id: plan.id }, errors: [], assessments: [],
    executions: [{ executionId: "default", profileId: "default", outcome: { kind: "passed" } }],
    evidence: { executions: [{ executionId: "default", profileId: "default", operations: operations.map((operation) => ({ operationId: operation.id, operationKind: "state", outcome: { kind: "passed" } })) }] } });
  const metric = output.measurements.find((item) => item.id === "axe/pageState/violations");
  assert.deepEqual([metric?.status, metric?.reason], ["partial", "An axe audit did not complete."]);
});
