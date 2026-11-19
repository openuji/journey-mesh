import assert from "node:assert/strict";
import test from "node:test";
import { buildTestModel } from "@openuji/journey-reporter";
import { projectJourneyPath } from "../src/journey-path.js";
import { savedTest } from "../../../packages/journey-reporter/test/fixtures.js";

const model = (record = savedTest()) => buildTestModel({ test: record, excludedPhaseIds: [], views: {}, interpreted: [] });

test("compiled operation occurrences remain distinct and screenshots match the exact execution", () => {
  const view = projectJourneyPath("manual-plan", model().profiles[0], ["task"]);
  assert.equal(Object.keys(view.graphs[0].document.journey.states).length, 2);
  assert.equal(view.graphs[0].states["first-occurrence"].screenshot, "tests/manual-plan/files/right.png");
  assert.equal(view.graphs[0].states["second-occurrence"].screenshot, undefined);
  assert.equal(view.graphs[0].states["second-occurrence"].outcome, "failed");
});

test("unexecuted states remain planned and are never presented as passed", () => {
  const record = structuredClone(savedTest());
  (record.result.evidence.executions[0].operations as unknown as unknown[]).pop();
  assert.equal(projectJourneyPath("manual-plan", model(record).profiles[0]).graphs[0].states["second-occurrence"].outcome, "not-executed");
});
