import assert from "node:assert/strict";
import test from "node:test";
import { immutableSnapshot, type JourneyMeasurement } from "@openuji/journey-core";
import { compareMeasurements, inferPairings, validatePairings, reportJourneyResult } from "../src/index.js";
import type { SuiteResultBundle, ComparisonResultBundle, JourneyArtifactStore } from "@openuji/journey-plugin";

function suite(testId: string, profileId: string, value: number): SuiteResultBundle {
  const runId = `${testId}-run`;
  const metric: JourneyMeasurement = { id: "custom/effort", label: "Custom effort", method: "custom-provider", unit: "gesture", aggregation: "count", status: "available", value, scope: { runId, executionId: "execution", profileId, operationIds: [] } };
  return immutableSnapshot({ kind: "suite", ok: true, generatedAt: "now", errors: [], artifacts: [], tests: [{ kind: "test", id: testId, segments: [], views: {}, plan: { id: "plan", operations: [] }, result: { ok: true, runId, plan: { id: "plan" }, assessments: [{ kind: "applicable", profile: { id: profileId } }], executions: [{ executionId: "execution", profileId, outcome: { kind: "passed" } }], evidence: { executions: [] }, errors: [] }, outputs: [{ id: "third-party-observer", kind: "unfamiliar", measurements: [metric], evidence: { proof: true }, errors: [] }], reportingErrors: [], artifacts: [] }] });
}
const explicit = [{ id: "same-purpose", baseline: { test: "old-journey", profile: "mouse" }, candidate: { test: "new-journey", profile: "touch" } }];
function comparison(left = suite("old-journey", "mouse", 6), right = suite("new-journey", "touch", 2)): ComparisonResultBundle {
  return { kind: "comparison", title: "Comparison", ok: true, generatedAt: "now", subjects: { baseline: { source: "a", bundle: left, errors: [] }, candidate: { source: "b", bundle: right, errors: [] } }, pairings: validatePairings(explicit, { baseline: left, candidate: right }), errors: [], artifacts: [] };
}

test("pairings are inferred from equal test and profile IDs; different IDs need explicit pairings", () => {
  const same = inferPairings(suite("task", "mouse", 1), suite("task", "mouse", 2));
  assert.deepEqual(same.map((pairing) => [pairing.baseline.test, pairing.candidate.profile]), [["task", "mouse"]]);
  const different = inferPairings(suite("old-journey", "mouse", 1), suite("new-journey", "touch", 2));
  assert.equal(different.length, 2);
  assert.ok(different.every((pairing) => !pairing.baseline.test || !pairing.candidate.test));
  assert.throws(() => validatePairings([{ ...explicit[0], candidate: { test: "missing", profile: "touch" } }], { baseline: suite("old-journey", "mouse", 1), candidate: suite("new-journey", "touch", 2) }), /Unknown candidate selection/);
  assert.throws(() => validatePairings([explicit[0], explicit[0]], { baseline: null, candidate: null }), /Duplicate pairing/);
});

test("unfamiliar provider metrics compare across different tests and profiles using explicit pairings", () => {
  const bundle = comparison();
  const rows = compareMeasurements(bundle);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].delta, -4);
  assert.equal(rows[0].observer, "third-party-observer");
  assert.deepEqual(compareMeasurements(JSON.parse(JSON.stringify(bundle))), rows);
});

test("partial and incompatible measurements retain values without calculated deltas", () => {
  const bundle = structuredClone(comparison());
  const metric = bundle.subjects.candidate.bundle!.tests[0].outputs[0].measurements[0] as { method: string; status: JourneyMeasurement["status"] };
  metric.method = "another-method";
  assert.equal(compareMeasurements(bundle)[0].status, "incompatible");
  assert.equal(compareMeasurements(bundle)[0].delta, null);
  metric.status = "partial";
  assert.equal(compareMeasurements(bundle)[0].status, "partial");
});

test("reporter failures are isolated and every reporter sees an immutable detached bundle", async () => {
  const bundle = comparison(); const writes: string[] = [];
  const artifacts = { async write(input: { name: string }) { writes.push(input.name); return {} as never; } } as unknown as JourneyArtifactStore;
  const errors = await reportJourneyResult({ bundle, artifacts, reporters: [
    { name: "failing", report({ bundle: snapshot }) { assert.notEqual(snapshot, bundle); assert.ok(Object.isFrozen(snapshot)); throw new Error("write failed"); } },
    { name: "remaining", async report({ artifacts: store }) { await store.write({ name: "retained.json", data: "{}", contentType: "application/json" }); } }
  ] });
  assert.equal(errors.length, 1);
  assert.deepEqual(writes, ["retained.json"]);
  assert.equal(bundle.ok, true);
});
