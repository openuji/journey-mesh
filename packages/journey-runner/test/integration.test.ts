import assert from "node:assert/strict";
import test from "node:test";
import {
  MaterializationFailedError,
  routedExecutor,
  runJourney,
  type JourneyExecutor,
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
  const executor: JourneyExecutor = {
    name: "test-executor",
    createSession() {
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
    executor,
    environment: { verifyEffect: ({ effect }) => { calls.push(`effect:${effect.id}`); } }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["start", "entry", "state", `transition:${modality.id}`, "effect:urn:test:effect", "close:false"]);
  assert.ok(Object.isFrozen(result.evidence.executions));
  assert.ok(Object.isFrozen(result.evidence.executions[0]!.operations));
  assert.equal(result.evidence.executions[0]!.operations[1]!.executor?.name, "test-executor");
});

test("runner preserves operation and cleanup failures without mutable flags", async () => {
  const result = await runJourney({
    plan: plan(state),
    profiles: [{ id: "profile" }],
    executor: {
      name: "failing",
      createSession: () => ({
        start() {}, openEntry() {}, assertState() { throw new Error("operation failed"); },
        performTransition() {}, recordControlFlow() {}, close() { throw new Error("cleanup failed"); }
      })
    }
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0]!.message, /operation failed.*cleanup failed/s);
  assert.equal(result.executions[0]!.outcome.kind, "failed");
});

test("routed executors allocate only used children and close them in reverse order", async () => {
  const calls: string[] = [];
  const child = (name: string): JourneyExecutor => ({
    name,
    createSession: () => ({
      start() { calls.push(`start:${name}`); }, openEntry() {}, assertState() { calls.push(`state:${name}`); },
      performTransition() {}, recordControlFlow() {}, close() { calls.push(`close:${name}`); }
    })
  });
  const first = child("first"), second = child("second"), unused = child("unused");
  const firstState = { ...state, id: "first", touchpointId: "first" };
  const secondState = { ...state, id: "second", touchpointId: "second", sequence: 1 };
  const executor = routedExecutor((operation) => operation.touchpointId === "first" ? first : operation.touchpointId === "second" ? second : unused);
  const result = await runJourney({ plan: plan(firstState, secondState), profiles: [{ id: "profile" }], executor });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["start:first", "start:second", "state:first", "state:second", "close:second", "close:first"]);
});

test("a journey observer that throws fails the result and changes nothing that runs", async () => {
  const calls: string[] = [];
  const result = await runJourney({
    plan: plan(state),
    profiles: [{ id: "profile" }],
    executor: {
      name: "observed",
      createSession: () => ({
        start() {}, openEntry() {}, assertState() { calls.push("state"); },
        performTransition() {}, recordControlFlow() {}, close({ executionFailed }) { calls.push(`close:${executionFailed}`); }
      })
    },
    observers: [
      { name: "broken", onRunStarted() { throw new Error("run observer broke"); }, onExecutionStarted() { throw new Error("execution observer broke"); } },
      { name: "other", onRunStarted() { calls.push("other:run"); }, onExecutionStarted() { calls.push("other:execution"); } }
    ]
  });
  assert.deepEqual(calls, ["other:run", "other:execution", "state", "close:false"]);
  assert.deepEqual(result.evidence.executions[0]!.operations.map((operation) => operation.outcome.kind), ["passed"]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.message), ["run observer broke", "execution observer broke"]);
});

const fallbackDecision = (startLocator?: { id: string; features: []; contexts: [] }) => ({ profileId: "profile", inputModalityProfile: modalityProfile, modality, materialization: { id: "urn:test:expected", transitionId: "urn:test:transition", modality, steps: [] }, fallback: { id: "urn:test:around", transitionId: "urn:test:transition", modality, steps: [], ...(startLocator ? { startLocator } : {}) } });

const start = { id: "urn:test:start", features: [] as [], contexts: [] as [] };
const checkFailed = (id: string, sentInput = false) => new MaterializationFailedError(`${id} failed`, sentInput);

/** Runs a transition whose materializations throw what `failing` names for them. */
async function runWithFallback(failing: Readonly<Record<string, Error>>, startLocator?: typeof start) {
  const calls: string[] = [];
  const result = await runJourney({
    plan: plan(state, transition, { ...state, id: "after", sequence: 2 }),
    profiles: [{ id: "profile", selectInputModality: () => fallbackDecision(startLocator) }],
    executor: {
      name: "fallback",
      createSession: () => ({
        start() {}, openEntry() {},
        assertState(operation) { calls.push(`state:${operation.id}`); },
        performTransition(_operation, decision) {
          const id = decision!.materialization!.id;
          calls.push(`perform:${id}${decision!.fallback ? " (has fallback)" : ""}`);
          if (failing[id]) throw failing[id];
        },
        recordControlFlow() {}, close({ executionFailed }) { calls.push(`close:${executionFailed}`); }
      })
    },
    environment: { verifyEffect: ({ decision }) => { calls.push(`effect:${decision?.materialization?.id}`); } }
  });
  return { result, calls, operations: result.evidence.executions[0]!.operations };
}

const takenThroughFallback = ["state:state", "perform:urn:test:expected (has fallback)", "perform:urn:test:around", "effect:urn:test:around", "state:after", "close:true"];
const stoppedAtExpected = ["state:state", "perform:urn:test:expected (has fallback)", "close:true"];

test("a transition taken through its fallback fails its operation and the execution, and the journey goes on", async () => {
  const { result, calls, operations } = await runWithFallback({ "urn:test:expected": checkFailed("urn:test:expected") });
  assert.deepEqual(calls, takenThroughFallback);
  assert.equal(result.ok, false);
  assert.deepEqual(operations.map((operation) => operation.outcome.kind), ["passed", "failed", "passed"]);
  const failed = operations[1]!.outcome;
  assert.ok(failed.kind === "failed");
  assert.equal(failed.error.message, "urn:test:expected failed (the transition was then taken through urn:test:around)");
  assert.equal(result.errors[0]!.message, failed.error.message);
});

test("after input was sent, a fallback is performed only if it names its start", async () => {
  const failing = { "urn:test:expected": checkFailed("urn:test:expected", true) };
  assert.deepEqual((await runWithFallback(failing, start)).calls, takenThroughFallback);
  const { result, calls } = await runWithFallback(failing);
  assert.deepEqual(calls, stoppedAtExpected);
  assert.deepEqual(result.errors.map((error) => error.message),
    ["urn:test:expected failed (urn:test:around was not performed: input had been sent, and it names no start)"]);
});

test("only a failed check of the canonical materialization runs its fallback", async () => {
  const { result, calls } = await runWithFallback({ "urn:test:expected": new Error("browser closed") }, start);
  assert.deepEqual(calls, stoppedAtExpected);
  assert.deepEqual(result.errors.map((error) => error.message), ["browser closed"]);
});

test("a fallback that fails too stops the profile, and both errors are kept", async () => {
  const { result, calls, operations } = await runWithFallback({ "urn:test:expected": checkFailed("urn:test:expected"), "urn:test:around": checkFailed("urn:test:around") });
  assert.deepEqual(calls, ["state:state", "perform:urn:test:expected (has fallback)", "perform:urn:test:around", "close:true"]);
  assert.equal(result.ok, false);
  assert.deepEqual(operations.map((operation) => operation.outcome.kind), ["passed", "failed"]);
  assert.equal(result.errors[0]!.message, "urn:test:expected failed; urn:test:around failed too: urn:test:around failed");
});

test("a canonical materialization that passes never runs its fallback", async () => {
  const { result, calls } = await runWithFallback({});
  assert.deepEqual(calls, ["state:state", "perform:urn:test:expected (has fallback)", "effect:urn:test:expected", "state:after", "close:false"]);
  assert.equal(result.ok, true);
});
