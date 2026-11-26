import assert from "node:assert/strict";
import test from "node:test";
import { deriveUXOutput, immutableSnapshot, type UXConfiguration } from "../src/index.js";
import type { JourneyInputAction } from "@openuji/journey-core";
import type { JourneyPlanOperation } from "@openuji/journey-execution-model";
import type { RunResult } from "@openuji/journey-runner";

const vertex = { id: "state", type: "State" as const };
const surface = { id: "surface" };
const base = {
  actorId: "person",
  touchpointId: "application",
  entry: { id: "entry", stateId: "arrival" },
  segment: "recipient",
};
const state = (id: string): JourneyPlanOperation => ({
  ...base,
  id,
  sequence: 0,
  kind: "state",
  state: { id },
  surface,
  target: {
    expectedMatchCount: 1,
    bindings: [],
    observation: {
      stateId: id,
      surfaceId: surface.id,
      expectedMatchCount: 1,
      bindings: [],
    },
  },
});
const action = (id: string, input = true): JourneyPlanOperation => ({
  ...base,
  id,
  sequence: 0,
  kind: "transition",
  transition: { id, from: vertex.id, to: vertex.id },
  from: vertex,
  to: vertex,
  surface,
  effects: [],
  activation: {
    transitionId: id,
    eventId: "invoke",
    from: vertex,
    to: vertex,
    surfaceId: surface.id,
    bindings: [
      {
        id: "binding",
        surfaceId: surface.id,
        eventId: "invoke",
        requiredInputModalityProfiles: [],
        locators: [
          { id: "target", role: "button", features: [], contexts: [] },
        ],
      },
    ],
    requiredInputModalityProfiles: input
      ? [{ id: "input", modalities: [{ id: "activate" }] }]
      : [],
  },
});
const operations = immutableSnapshot([
  state("setup"),
  state("arrival"),
  action("navigate"),
  state("offer"),
  action("accept"),
  action("automatic", false),
  state("done"),
]);
function result(
  ops: readonly JourneyPlanOperation[] = operations,
  fail?: string,
): RunResult {
  return immutableSnapshot({
    ok: !fail,
    runId: "run-a",
    plan: { id: "plan" },
    assessments: [],
    errors: [],
    executions: [
      {
        executionId: "execution",
        profileId: "default",
        outcome: { kind: "passed" },
      },
    ],
    evidence: {
      executions: [
        {
          executionId: "execution",
          profileId: "default",
          operations: ops.map((op) => ({
            operationId: op.id,
            operationKind: op.kind,
            outcome:
              op.id === fail
                ? {
                    kind: "failed" as const,
                    error: { name: "Error", message: "failed" },
                  }
                : { kind: "passed" as const },
          })),
        },
      ],
    },
  });
}


const config: UXConfiguration = {
  id: "interactions", operations,
  counters: [
    { id: "inputs", label: "Command attempts", from: "arrival", until: "done" },
    { id: "navigation", label: "Navigation", from: "arrival", until: "accept", operations: ["navigate"] }
  ],
  checkpoints: [{ id: "goal", label: "Goal verified", operation: "accept" }],
  probes: [{ id: "discover", label: "Target", at: "arrival", target: "accept" }]
};
const actionFact = (id: string, operationId: string, status: JourneyInputAction["status"] = "completed"): JourneyInputAction => ({
  id, operationId, status, runId: "run-a", executionId: "execution", profileId: "default", modalityId: "activate", command: "click", unit: "adapter-command"
});
const derive = (execution = result(), actions = [actionFact("a", "navigate"), actionFact("b", "accept")]) => deriveUXOutput({ ...config, result: execution, actions, observations: [] });

test("counts actual commands, excludes setup and synthetic operations, and detaches evidence", () => {
  const actions = [actionFact("setup", "setup"), actionFact("a", "navigate", "attempted"), actionFact("a", "navigate"), actionFact("b", "accept")];
  const output = derive(result(), actions);
  assert.equal(output.measurements[0].value, 2);
  assert.equal(output.measurements[1].value, 1);
  assert.equal(output.measurements[2].value, true);
  assert.equal(derive(result(), []).measurements[0].value, 0);
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(actions), false);
  assert.deepEqual(output, derive(result(), actions));
});

test("an executed command remains counted when the operation or later assertion fails", () => {
  const output = derive(result(operations.slice(0, 5), "accept"), [actionFact("a", "navigate"), actionFact("b", "accept", "failed")]);
  assert.equal(output.measurements[0].status, "partial");
  assert.equal(output.measurements[0].value, 2);
  assert.equal(output.measurements[2].value, false);
});

test("unexecuted intervals and probes are unavailable rather than zero", () => {
  const output = derive(result(operations.slice(0, 1)), []);
  assert.equal(output.measurements[0].status, "unavailable");
  assert.equal(output.measurements[0].value, null);
  assert.equal(output.measurements[2].value, null);
  assert.equal(output.measurements[3].value, null);
});

test("scopes isolate run, execution and profile without source graph identifiers", () => {
  const foreign = [{ ...actionFact("foreign", "navigate"), runId: "another" }, { ...actionFact("other-profile", "accept"), profileId: "other" }];
  assert.equal(derive(result(), foreign).measurements[0].value, 0);
  const output = deriveUXOutput({ ...config, result: result(), actions: [], observations: [{ runId: "run-a", executionId: "execution", profileId: "default", operationId: "arrival", probeId: "discover", targetOperationId: "accept", visible: true, inViewport: false }] });
  assert.equal(output.measurements[3].value, true);
  assert.equal(output.measurements[4].value, false);
});

test("compiled references are validated before collection", () => {
  assert.throws(() => deriveUXOutput({ ...config, counters: [{ id: "invalid", label: "Invalid", from: "missing", until: "done" }], result: result(), actions: [], observations: [] }), /compiled operation/);
});

test("manual plans need no source references for measurement", () => {
  const manual = operations.map(({ source: _source, ...operation }) => operation);
  const output = deriveUXOutput({ ...config, operations: manual, result: result(manual), actions: [actionFact("command", "accept")], observations: [] });
  assert.equal(output.measurements[0].value, 1);
});

test("a transition taken through its fallback counts the inputs of the path that took it, and the interval completes", () => {
  const through = (id: string, operationId: string, materializationId: string, status: JourneyInputAction["status"] = "completed") => ({ ...actionFact(id, operationId, status), materializationId });
  const actions = [actionFact("a", "navigate"), through("b", "accept", "urn:canonical", "failed"), through("c", "accept", "urn:fallback"), through("d", "accept", "urn:fallback")];
  const output = derive(result(operations, "accept"), actions);
  assert.deepEqual([output.measurements[0].status, output.measurements[0].value], ["available", 3]);
  assert.equal(output.measurements[2].value, false, "the checkpoint still says the canonical path failed");
});
