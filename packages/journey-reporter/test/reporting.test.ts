import assert from "node:assert/strict";
import test from "node:test";
import { immutableSnapshot, type JourneyMeasurement } from "@openuji/journey-core";
import { testRecordFormat, type SuiteRun } from "@openuji/journey-run-record";
import { compareMeasurements, inferPairings, validatePairings } from "../src/index.js";
import { suiteRun } from "./fixtures.js";

function suite(testId: string, profileId: string, value: number): SuiteRun {
  const runId = `${testId}-run`;
  const metric: JourneyMeasurement = { id: "custom/effort", label: "Custom effort", method: "custom-provider", unit: "gesture", aggregation: "count", status: "available", value, scope: { runId, executionId: "execution", profileId, operationIds: [] } };
  return immutableSnapshot(suiteRun([{ format: testRecordFormat, version: 2, id: testId, ok: true, segments: [], views: {}, plan: { id: "plan", operations: [] },
    result: { ok: true, runId, plan: { id: "plan" }, assessments: [{ kind: "applicable", profile: { id: profileId } }], executions: [{ executionId: "execution", profileId, outcome: { kind: "passed" } }], evidence: { executions: [] }, errors: [] },
    observers: [{ id: "third-party-observer", kind: "unfamiliar", measurements: [metric], evidence: { proof: true }, errors: [] }], observerErrors: [], files: [] }]));
}
const explicit = [{ id: "same-purpose", baseline: { test: "old-journey", profile: "mouse" }, candidate: { test: "new-journey", profile: "touch" } }];

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
  const subjects = { baseline: suite("old-journey", "mouse", 6), candidate: suite("new-journey", "touch", 2) };
  const rows = compareMeasurements(validatePairings(explicit, subjects), subjects);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].delta, -4);
  assert.equal(rows[0].observer, "third-party-observer");
});

test("partial and incompatible measurements retain values without calculated deltas", () => {
  const subjects = structuredClone({ baseline: suite("old-journey", "mouse", 6), candidate: suite("new-journey", "touch", 2) });
  const metric = subjects.candidate.tests[0].observers[0].measurements[0] as { method: string; status: JourneyMeasurement["status"] };
  metric.method = "another-method";
  assert.equal(compareMeasurements(explicit, subjects)[0].status, "incompatible");
  assert.equal(compareMeasurements(explicit, subjects)[0].delta, null);
  metric.status = "partial";
  assert.equal(compareMeasurements(explicit, subjects)[0].status, "partial");
});
