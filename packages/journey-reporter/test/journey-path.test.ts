import assert from "node:assert/strict";
import test from "node:test";
import { projectJourneyPath } from "../src/journey-path.js";
import { savedTest } from "./fixtures.js";

test("compiled operation occurrences remain distinct and screenshots match the exact execution", () => {
  const bundle = savedTest(); const before = JSON.stringify(bundle);
  const view = projectJourneyPath(bundle, "keyboard", ["task"]);
  assert.equal(Object.keys(view.graphs[0].document.journey.states).length, 2);
  assert.equal(view.graphs[0].states["first-occurrence"].screenshot, "right.png");
  assert.equal(view.graphs[0].states["second-occurrence"].screenshot, undefined);
  assert.equal(view.graphs[0].states["second-occurrence"].outcome, "failed");
  assert.equal(JSON.stringify(bundle), before);
  assert.ok(Object.isFrozen(view));
});

test("unexecuted states remain planned and are never presented as passed", () => {
  const bundle = structuredClone(savedTest());
  (bundle.result.evidence.executions[0].operations as unknown as unknown[]).pop();
  assert.equal(projectJourneyPath(bundle, "keyboard").graphs[0].states["second-occurrence"].outcome, "unexecuted");
});
