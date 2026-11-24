import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyInputAction } from "@openuji/journey-core";
import { isOperabilityOutput, operabilityObserver } from "../src/index.js";
import { journeyMeshPlugin } from "../src/plugin.js";

const execution = (runId: string) => ({ runId, executionId: `${runId}/keyboard`, profile: { id: "keyboard-only" }, executor: { name: "playwright" } });
const keyboard = { id: "observability:keyboard" };
const decision = {
  profileId: "keyboard-only", inputModalityProfile: { id: "urn:input-profile:keyboard", modalities: [keyboard] }, modality: keyboard,
  materialization: { id: "urn:materialization:select-drafts:keyboard", transitionId: "urn:transition:select-drafts", modality: keyboard, steps: [] }
};
const action = (runId: string, id: string, status: JourneyInputAction["status"], extra: Partial<JourneyInputAction> = {}): JourneyInputAction => ({
  id, runId, executionId: `${runId}/keyboard`, profileId: "keyboard-only", operationId: "select-drafts", modalityId: keyboard.id,
  command: "move", unit: "adapter-command", status, ...extra
});

test("the observer records each transition's decision and every command's final status for its run", () => {
  const observer = operabilityObserver({ id: "input-steps" });
  for (const runId of ["run-a", "run-b"]) {
    observer.observeOperation!({ stage: "transition-ready", execution: execution(runId), operation: { id: "select-drafts" }, decision } as never);
  }
  observer.observeOperation!({ stage: "state-asserted", execution: execution("run-a"), operation: { id: "drafts" } } as never);
  observer.onAction!(action("run-a", "a/0", "attempted", { stepId: "urn:step:1" }));
  observer.onAction!(action("run-a", "a/0", "completed", { stepId: "urn:step:1", gesture: "Tab" }));
  observer.onAction!(action("run-a", "a/1", "attempted", { stepId: "urn:step:2" }));
  observer.onAction!(action("run-a", "a/1", "failed", { stepId: "urn:step:2", gesture: "ArrowRight", error: { name: "Error", message: "focus did not move" } }));
  observer.onAction!(action("run-b", "b/0", "completed"));

  const output = observer.output({ runId: "run-a" } as never);
  assert.ok(isOperabilityOutput(output));
  assert.equal(output.id, "input-steps");
  assert.deepEqual(output.evidence.decisions, [{
    runId: "run-a", executionId: "run-a/keyboard", profileId: "keyboard-only", operationId: "select-drafts",
    inputModalityProfileId: "urn:input-profile:keyboard", modalityId: "observability:keyboard", materializationId: "urn:materialization:select-drafts:keyboard"
  }]);
  assert.deepEqual(output.evidence.actions.map((item) => [item.id, item.status, item.gesture]), [["a/0", "completed", "Tab"], ["a/1", "failed", "ArrowRight"]]);
  assert.ok(Object.isFrozen(output.evidence.actions));
  assert.doesNotThrow(() => structuredClone(output));
});

test("the guard rejects other kinds and malformed evidence", () => {
  assert.equal(isOperabilityOutput({ id: "x", kind: "ux", measurements: [], evidence: {}, errors: [] }), false);
  assert.equal(isOperabilityOutput({ id: "x", kind: "operability", measurements: [], evidence: { format: "other" }, errors: [] }), false);
});

test("the plugin requires an output id and accepts no other options", () => {
  assert.deepEqual(journeyMeshPlugin.parse({ id: "input-steps" }, {} as never), { id: "input-steps" });
  assert.throws(() => journeyMeshPlugin.parse({}, {} as never), /id must be a nonempty string/);
  assert.throws(() => journeyMeshPlugin.parse({ id: "x", strict: true }, {} as never), /Unknown option strict/);
});
