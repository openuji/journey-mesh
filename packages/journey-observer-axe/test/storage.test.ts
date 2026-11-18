import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executionDescriptor, type JourneyPlan, type RunResult } from "@openuji/journey-runner";
import { defaultMaxFileBytes, readJsonDocument } from "@openuji/journey-plugin";
import { fileArtifactStore, writeReport, readReport } from "@openuji/journey-reporter";
import { axeObserver } from "../src/index.js";
import { axeReporter } from "../src/reporter.js";
import { buildAxeAuditReport } from "../src/audit/audit-report.js";
import type { AxeAuditReport, AxeResults } from "../src/types.js";

test("308 audits preserve all 153252 passing nodes once while every report file stays under 5 MiB", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "axe-storage-scale-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifacts = fileArtifactStore(join(directory, "scale"));
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
  const rawAudits = artifacts.files.filter((file) => file.storage === "json-document" && file.name.endsWith(".axe.json"));
  assert.equal(rawAudits.length, 308, "capture persists raw audits without requiring a reporter");
  const raw = await readJsonDocument<AxeAuditReport>((ref) => artifacts.read(ref), rawAudits[0]);
  assert.equal(raw.scans.pageState.passes[0].nodes.length, 248);
  assert.match(raw.scans.pageState.passes[0].nodes[0].html, /raw-only-0-0/);
  const draft = { kind: "test" as const, id: "scale", segments: [], views: {}, plan, result, outputs: [output], reportingErrors: [], artifacts: artifacts.files };
  await axeReporter().report({ bundle: draft, artifacts });
  assert.equal(artifacts.files.filter((file) => file.storage === "json-document" && file.name.endsWith(".axe.json")).length, 308);
  await writeReport(directory, { kind: "suite", ok: true, generatedAt: "now", errors: [], artifacts: [], tests: [{ ...draft, artifacts: artifacts.files }] });
  const restored = await readReport(directory, ["suite"]);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.tests[0].outputs[0].nodes, output.nodes);
  let passingNodes = 0, total = 0;
  for (const file of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!file.isFile()) continue;
    const path = join(file.parentPath, file.name);
    const size = (await stat(path)).size;
    assert.ok(size <= defaultMaxFileBytes, `${path}: ${size}`); total += size;
    if (path.endsWith(".json")) passingNodes += ((await readFile(path, "utf8")).match(/raw-only-/g) ?? []).length;
  }
  assert.equal(passingNodes, 153_252);
  assert.ok((await stat(join(directory, "index.html"))).size < 10_000);
  t.diagnostic(`308 audits, 616 scans, ${passingNodes} passing nodes preserved in ${(total / 1024 / 1024).toFixed(2)} MiB; no file exceeds 5 MiB.`);
});
