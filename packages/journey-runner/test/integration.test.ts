import assert from "node:assert/strict";
import test from "node:test";
import {
  routedAdapter,
  runJourney,
  type JourneyAdapter,
  type JourneyPlan,
  type JourneyPlanOperation,
  type StatePlanOperation,
  type TransitionPlanOperation
} from "../src/index.js";

const vertex = Object.freeze({ id: "urn:test:state", type: "State" as const });
const surface = Object.freeze({ id: "urn:test:surface" });
const base = Object.freeze({
  actorId: "urn:test:actor",
  touchpointId: "urn:test:touchpoint",
  entry: Object.freeze({ id: "urn:test:entry", stateId: vertex.id }),
  entryBinding: Object.freeze({ id: "urn:test:binding", value: "opaque-entry" })
});
const state: StatePlanOperation = {
  ...base,
  id: "state",
  sequence: 0,
  kind: "state",
  state: vertex,
  surface,
  target: {
    expectedMatchCount: 0,
    bindings: [],
    observation: { stateId: vertex.id, surfaceId: surface.id, expectedMatchCount: 0, bindings: [] }
  }
};
const modality = Object.freeze({ id: "urn:test:activate" });
const modalityProfile = Object.freeze({ id: "urn:test:profile", modalities: Object.freeze([modality]) });
const transition: TransitionPlanOperation = {
  ...base,
  id: "transition",
  sequence: 1,
  kind: "transition",
  transition: { id: "urn:test:transition", from: vertex.id, to: vertex.id },
  from: vertex,
  to: vertex,
  surface,
  activation: {
    transitionId: "urn:test:transition",
    eventId: "urn:test:event",
    from: vertex,
    to: vertex,
    surfaceId: surface.id,
    requiredInputModalityProfiles: [modalityProfile],
    bindings: []
  },
  effects: [{ id: "urn:test:effect", producedRefs: [], consumedRefs: [], produced: [], consumed: [] }]
};

function plan(...operations: JourneyPlanOperation[]): JourneyPlan {
  return Object.freeze({ id: "urn:test:plan", operations: Object.freeze(operations) });
}

test("runner owns operation order, effects, immutable evidence, and cleanup", async () => {
  const calls: string[] = [];
  const adapter: JourneyAdapter = {
    name: "test-adapter",
    createExecution() {
      return {
        start() { calls.push("start"); },
        openEntry() { calls.push("entry"); },
        assertState() { calls.push("state"); },
        performTransition(_operation, decision) { calls.push(`transition:${decision?.modality.id}`); },
        recordControlFlow() { calls.push("control"); },
        close({ executionFailed }) { calls.push(`close:${executionFailed}`); }
      };
    }
  };
  const result = await runJourney({
    runId: "run",
    plan: plan(state, transition),
    profiles: [{ id: "profile", selectInputModality: () => ({ profileId: "profile", inputModalityProfile: modalityProfile, modality }) }],
    adapter,
    environment: { verifyEffect: ({ effect }) => { calls.push(`effect:${effect.id}`); } }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["start", "entry", "state", `transition:${modality.id}`, "effect:urn:test:effect", "close:false"]);
  assert.ok(Object.isFrozen(result.evidence.executions));
  assert.ok(Object.isFrozen(result.evidence.executions[0]!.operations));
  assert.equal(result.evidence.executions[0]!.operations[1]!.adapter?.name, "test-adapter");
});

test("runner preserves operation and cleanup failures without mutable flags", async () => {
  const result = await runJourney({
    plan: plan(state),
    profiles: [{ id: "profile" }],
    adapter: {
      name: "failing",
      createExecution: () => ({
        start() {}, openEntry() {}, assertState() { throw new Error("operation failed"); },
        performTransition() {}, recordControlFlow() {}, close() { throw new Error("cleanup failed"); }
      })
    }
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0]!.message, /operation failed.*cleanup failed/s);
  assert.equal(result.executions[0]!.outcome.kind, "failed");
});

test("routed adapters allocate only used children and close them in reverse order", async () => {
  const calls: string[] = [];
  const child = (name: string): JourneyAdapter => ({
    name,
    createExecution: () => ({
      start() { calls.push(`start:${name}`); }, openEntry() {}, assertState() { calls.push(`state:${name}`); },
      performTransition() {}, recordControlFlow() {}, close() { calls.push(`close:${name}`); }
    })
  });
  const first = child("first"), second = child("second"), unused = child("unused");
  const firstState = { ...state, id: "first", touchpointId: "first" };
  const secondState = { ...state, id: "second", touchpointId: "second", sequence: 1 };
  const adapter = routedAdapter((operation) => operation.touchpointId === "first" ? first : operation.touchpointId === "second" ? second : unused);
  const result = await runJourney({ plan: plan(firstState, secondState), profiles: [{ id: "profile" }], adapter });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["start:first", "start:second", "state:first", "state:second", "close:second", "close:first"]);
});
