import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { testRecordFormat, type SuiteRun, type TestRecord } from "@openuji/journey-run-record";
import { writeRunRecord } from "@openuji/journey-run-record/node";
import { buildReport, parseReportConfig, type TestModel } from "@openuji/journey-reporter";
import type { AxeAuditReport, AxeObserverOutput, AxeResults, LinkedAxeFact } from "@openuji/journey-observer-axe/evidence";
import { accessibilitySummaryFormat, axePathFormat, type AxeAccessibilitySummaryReport, type AxePathAuditReport } from "../src/index.js";

const interpreter = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const config = parseReportConfig({ report: { interpreters: [{ use: interpreter }] } });
const counts = (results: AxeResults) => ({ violations: results.violations.length, incomplete: results.incomplete.length, passes: results.passes.length, inapplicable: results.inapplicable.length });

function audit(auditId: string, scans: { pageState: AxeResults; matchedSurface: AxeResults }): AxeAuditReport {
  const page = counts(scans.pageState), surface = counts(scans.matchedSurface);
  return { auditId, createdAt: "now", url: "https://example.test/", strict: false, wcagTags: [], metadata: {},
    summary: { violations: page.violations + surface.violations, incomplete: page.incomplete + surface.incomplete, passes: page.passes + surface.passes, inapplicable: page.inapplicable + surface.inapplicable },
    scans, evidence: { pageState: { nodes: [] }, matchedSurface: { nodes: [] } } } as unknown as AxeAuditReport;
}
const results = (violations: number, passNodes = 1, proof = ""): AxeResults => ({ url: "https://example.test/", incomplete: [], inapplicable: [],
  violations: Array.from({ length: violations }, (_, index) => ({ id: `rule-${index}`, impact: "serious", help: "Help", helpUrl: "https://example.test/rule", description: "Description", tags: [],
    nodes: [{ target: ["#bad"], html: "<b>", failureSummary: "Fix it", any: [], all: [], none: [] }] })),
  passes: [{ id: "pass-rule", nodes: Array.from({ length: passNodes }, (_, index) => ({ target: [`#node-${index}`], html: `<div data-proof="${proof}-${index}">${proof ? "evidence ".repeat(50) : ""}</div>`, any: [], all: [], none: [] })) }]
} as unknown as AxeResults);

/** A recorded axe test: every state operation audited with `scans(index)`, raw audits as evidence files. */
async function recordedRun(directory: string, profiles: readonly string[], states: number, scans: (index: number) => { pageState: AxeResults; matchedSurface: AxeResults }): Promise<SuiteRun> {
  const operations = Array.from({ length: states }, (_, index) => ({
    id: `state-${index}`, sequence: index, kind: "state" as const, actorId: "actor", touchpointId: "app", segment: "task",
    entry: { id: "entry", stateId: "state-0" }, state: { id: `state-${index}`, label: `State ${index}` }, surface: { id: "surface" },
    target: { expectedMatchCount: 1, bindings: [], observation: { stateId: `state-${index}`, surfaceId: "surface", expectedMatchCount: 1, bindings: [] } }
  }));
  const plan = { id: "plan", operations };
  const journal: LinkedAxeFact[] = [];
  const files: TestRecord["files"][number][] = [];
  let auditIndex = 0;
  for (const profile of profiles) {
    journal.push({ kind: "execution-started", execution: { runId: "run", executionId: profile, plan, profile: { id: profile } } } as LinkedAxeFact);
    for (const operation of operations) {
      const auditId = `${profile}-${String(operation.sequence).padStart(3, "0")}-${operation.id}`;
      const href = `tests/axe/files/${auditId}.axe.json`;
      await mkdir(dirname(join(directory, href)), { recursive: true });
      await writeFile(join(directory, href), JSON.stringify(audit(auditId, scans(auditIndex++))));
      files.push({ name: `${auditId}.axe.json`, href, contentType: "application/json", format: "journey-mesh/axe-audit", scope: { runId: "run", executionId: profile, profileId: profile, operationId: operation.id } });
      journal.push({ kind: "operation-observed", evidence: { runId: "run", executionId: profile, profileId: profile, stage: "state-asserted", operation, expectedMatchCount: 1,
        screenshot: { kind: "not-requested" }, audit: { kind: "completed", document: { href } } } } as LinkedAxeFact);
    }
  }
  const output: AxeObserverOutput = { id: "axe-path", kind: "axe", measurements: [], errors: [], evidence: { reportId: "axe-path", createdAt: "now", wcagTags: ["wcag2a"], journal } };
  const test: TestRecord = { format: testRecordFormat, version: 2, id: "axe", ok: true, segments: [], views: {}, plan, observers: [output], observerErrors: [], files,
    result: { ok: true, runId: "run", plan: { id: "plan" }, errors: [], assessments: profiles.map((id) => ({ kind: "applicable", profile: { id } })),
      executions: profiles.map((id) => ({ executionId: id, profileId: id, outcome: { kind: "passed" } })),
      evidence: { executions: profiles.map((id) => ({ executionId: id, profileId: id, operations: operations.map((operation, index) => ({ operationId: operation.id, operationKind: "state",
        ...(index < states - 1 ? { executor: { name: "@openuji/journey-executor-playwright" } } : {}), outcome: { kind: "passed" } })) })) } } };
  const run: SuiteRun = { ok: true, startedAt: "now", finishedAt: "now", errors: [], provenance: {}, files: [], tests: [test] };
  await writeRunRecord(directory, run);
  return run;
}

test("recorded axe evidence becomes a path report, a summary, and journey-map node metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "report-axe-"));
  await recordedRun(directory, ["default"], 2, (index) => ({ pageState: results(index === 0 ? 2 : 0), matchedSurface: results(index === 0 ? 1 : 0) }));
  const { model, tests } = await buildReport(directory, { config });
  assert.deepEqual(model.errors, []);
  assert.deepEqual(model.tests[0].metricKinds, ["axe"]);
  const testModel: TestModel = tests[0];
  assert.deepEqual(testModel.profiles[0].steps.map((step) => step.metrics), [
    { kind: "axe", pageState: { violations: 2, incomplete: 0, passes: 1, inapplicable: 0 }, matchedSurface: { violations: 1, incomplete: 0, passes: 1, inapplicable: 0 } },
    { kind: "axe", pageState: { violations: 0, incomplete: 0, passes: 1, inapplicable: 0 }, matchedSurface: { violations: 0, incomplete: 0, passes: 1, inapplicable: 0 } }
  ]);
  assert.deepEqual(testModel.data.map((item) => [item.name, item.format, item.label ?? null]), [
    ["axe-path.json", axePathFormat, "Browser accessibility report (axe)"], ["accessibility-summary.json", accessibilitySummaryFormat, null]
  ]);
  const path = JSON.parse(await readFile(join(directory, testModel.data[0].href), "utf8")) as AxePathAuditReport;
  assert.equal(path.summary.audited, 2);
  assert.equal(path.items[0].sourceJsonHref, "tests/axe/files/default-000-state-0.axe.json");
  assert.deepEqual(path.items[0].findings!.violations.map((finding) => [finding.scanId, finding.ruleId, finding.nodes.map((node) => Object.keys(node).sort())]), [
    ["page-state", "rule-0", [["failureSummary", "nodeIndex", "target"]]], ["page-state", "rule-1", [["failureSummary", "nodeIndex", "target"]]], ["matched-surface", "rule-0", [["failureSummary", "nodeIndex", "target"]]]
  ]);
  assert.doesNotMatch(JSON.stringify(path), /html/i);
  const summary = JSON.parse(await readFile(join(directory, testModel.data[1].href), "utf8")) as AxeAccessibilitySummaryReport;
  assert.equal(summary.source.aggregateJsonHref, "axe-path.json");
  assert.equal(Object.keys(summary.states!).length, 2);
});

test("308 audits keep all 153252 passing nodes in raw evidence; the derived report references, never copies, them", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "report-axe-scale-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let scanIndex = 0;
  const scan = () => { const id = scanIndex++; return results(0, id < 132 ? 248 : 249, `raw-only-${id}`); };
  await recordedRun(directory, ["default", "keyboard"], 154, () => ({ pageState: scan(), matchedSurface: scan() }));
  assert.equal(scanIndex, 616);
  const { model, tests } = await buildReport(directory, { config });
  assert.deepEqual(model.errors, []);
  const path = JSON.parse(await readFile(join(directory, tests[0].data[0].href), "utf8")) as AxePathAuditReport;
  assert.equal(path.items.length, 308);
  assert.ok(path.items.every((item) => item.sourceJsonHref?.startsWith("tests/axe/files/")));
  let passingNodes = 0, reportNodes = 0;
  for (const file of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    const path = join(file.parentPath, file.name);
    const count = ((await readFile(path, "utf8")).match(/raw-only-/g) ?? []).length;
    if (path.includes(".axe.json")) passingNodes += count; else reportNodes += count;
  }
  assert.equal(passingNodes, 153_252);
  assert.equal(reportNodes, 0);
  t.diagnostic(`308 audits, 616 scans, ${passingNodes} passing nodes kept once in raw evidence.`);
});
