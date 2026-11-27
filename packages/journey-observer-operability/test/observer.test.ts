import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyInputAction } from "@openuji/journey-core";
import { isOperabilityOutput, operabilityObserver } from "../src/index.js";
import { journeyMeshPlugin as androidPlugin } from "../src/android-plugin.js";
import { journeyMeshPlugin as iosPlugin } from "../src/ios-plugin.js";
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
  for (const plugin of [journeyMeshPlugin, iosPlugin, androidPlugin]) {
    assert.deepEqual(plugin.parse({ id: "input-steps" }, {} as never), { id: "input-steps" });
    assert.throws(() => plugin.parse({}, {} as never), /id must be a nonempty string/);
    assert.throws(() => plugin.parse({ id: "x", strict: true }, {} as never), /Unknown option strict/);
  }
});

test("iOS operability plugin records executor-scoped operationIds and touch swipe-down materialization actions", async () => {
  const touch = { id: "urn:openuji:input:touch", label: "Touch" };
  const materialization = {
    id: "urn:materialization:bob-refreshes-files:touch",
    transitionId: "urn:transition:bob-refreshes-files",
    modality: touch,
    steps: [{ id: "urn:step:bob-refreshes-files:touch:1", kind: "move" as const, moveKind: { id: "urn:openuji:move:swipe-down", type: "move" as const } }]
  };
  const component = await iosPlugin.create(
    { id: "ios-input-steps" },
    { operations: [{ id: "bob-refresh" }] } as never
  );
  await component.observer.observeOperation!({
    stage: "transition-ready",
    execution: { runId: "run-ios", executionId: "touch-01", plan: { id: "plan", operations: [] }, profile: { id: "touch" } },
    operation: { id: "bob-refresh" } as never,
    session: {} as never,
    targets: [],
    expectedMatchCount: 1,
    decision: {
      profileId: "touch",
      inputModalityProfile: { id: "urn:input-modality-profile:touch", modalities: [touch] },
      modality: touch,
      materialization
    }
  });
  await component.observer.onAction!({
    id: "touch-01/action/0",
    runId: "run-ios",
    executionId: "touch-01",
    profileId: "touch",
    operationId: "bob-refresh",
    modalityId: touch.id,
    command: "move",
    materializationId: materialization.id,
    stepId: "urn:step:bob-refreshes-files:touch:1",
    unit: "adapter-command",
    status: "attempted"
  });
  await component.observer.onAction!({
    id: "touch-01/action/0",
    runId: "run-ios",
    executionId: "touch-01",
    profileId: "touch",
    operationId: "bob-refresh",
    modalityId: touch.id,
    command: "move",
    materializationId: materialization.id,
    stepId: "urn:step:bob-refreshes-files:touch:1",
    gesture: "swipe-down",
    unit: "adapter-command",
    status: "completed"
  });
  const output = await component.output({ result: { runId: "run-ios" } as never });
  assert.ok(isOperabilityOutput(output));
  assert.deepEqual(output.evidence.operationIds, ["bob-refresh"]);
  assert.equal(output.evidence.decisions[0]?.modalityId, "urn:openuji:input:touch");
  assert.equal(output.evidence.decisions[0]?.materializationId, materialization.id);
  assert.equal(output.evidence.actions[0]?.gesture, "swipe-down");
});
