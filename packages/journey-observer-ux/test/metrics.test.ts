import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  deriveJourneyMetrics,
  immutableSnapshot,
  type MetricSelection,
  type UXObservation,
} from "../src/index.js";
import type { JourneyPlanOperation } from "@openuji/journey-execution-model";
import type { RunResult } from "@openuji/journey-runner";
import { uxObserver } from "../src/playwright.js";
import type { PlaywrightOperationObservation } from "@openuji/journey-adapter-playwright";
import type { JourneyArtifactStore } from "@openuji/journey-runtime/plugin";

const vertex = { id: "state", type: "State" as const };
const surface = { id: "surface" };
const base = {
  actorId: "person",
  touchpointId: "application",
  entry: { id: "entry", stateId: "arrival" },
  source: { references: { journeyItemId: "recipient" } },
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
const selection: MetricSelection = {
  journeyItemId: "recipient",
  startStateId: "arrival",
  acceptanceTransitionId: "accept",
  completionStateId: "done",
  navigationTransitionIds: ["navigate"],
};
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
            graphNodeId: op.kind === "state" ? op.state.id : op.transition.id,
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

test("metrics are deterministic, application-neutral, detached, and exclude non-input operations", () => {
  const input = { operations, result: result(), observations: [], selection };
  const before = JSON.stringify(input);
  const first = deriveJourneyMetrics(input);
  assert.deepEqual(first, deriveJourneyMetrics(input));
  assert.equal(JSON.stringify(input), before);
  assert.equal(first[0].inputActions, 2);
  assert.equal(first[0].inputActionsToAcceptance, 2);
  assert.equal(first[0].acceptanceVerified, true);
  assert.equal(first[0].navigationBeforeAcceptance, 1);
  assert.equal(first[0].navigationAfterAcceptance, 0);
  assert.equal(first[0].automaticReveal, true);
  assert.ok(Object.isFrozen(first[0].observations));
  assert.throws(() => {
    (first[0] as { inputActions: number }).inputActions = 99;
  }, TypeError);
});

test("verified acceptance remains measurable when the subsequent UI continuation fails", () => {
  const [metrics] = deriveJourneyMetrics({
    operations,
    result: result(operations, "done"),
    observations: [],
    selection,
  });
  assert.equal(metrics.inputActions, null);
  assert.equal(metrics.inputActionsToAcceptance, 2);
  assert.equal(metrics.acceptanceVerified, true);
  assert.equal(metrics.navigationBeforeAcceptance, 1);
  assert.equal(metrics.navigationAfterAcceptance, null);
  assert.equal(metrics.automaticReveal, null);
});

test("failed and unexecuted landmarks do not become zero or successful measurements", () => {
  for (const execution of [
    result(operations.slice(0, -1)),
    result(operations, "accept"),
  ]) {
    const [metrics] = deriveJourneyMetrics({
      operations,
      result: execution,
      observations: [],
      selection,
    });
    assert.equal(metrics.status, "incomplete");
    assert.equal(metrics.inputActions, null);
    assert.equal(metrics.automaticReveal, null);
  }
});

test("probe evidence is isolated by run, profile, execution, and successful operation", () => {
  const fact: UXObservation = {
    runId: "run-a",
    executionId: "execution",
    profileId: "default",
    operationId: "arrival",
    graphNodeId: "arrival",
    probeId: "discover",
    targetGraphNodeId: "accept",
    visible: false,
    inViewport: false,
  };
  const observations = [
    fact,
    { ...fact, runId: "old-run" },
    { ...fact, profileId: "other" },
    { ...fact, executionId: "other" },
    { ...fact, operationId: "missing" },
  ];
  const [metrics] = deriveJourneyMetrics({
    operations,
    result: result(),
    observations,
    selection,
  });
  assert.deepEqual(metrics.observations, [fact]);
  assert.notEqual(metrics.observations[0], fact);
});

test("immutable snapshots do not freeze or retain caller-owned nested objects", () => {
  const input = { nested: [1] };
  const copy = immutableSnapshot(input);
  input.nested.push(2);
  assert.deepEqual(copy.nested, [1]);
  assert.ok(!Object.isFrozen(input));
});

test("observer captures passive facts and reporter preserves the functional result", async () => {
  const writes: string[] = [];
  const artifacts = {
    async write(input: { data: string }) {
      writes.push(input.data);
    },
  } as unknown as JourneyArtifactStore;
  const observer = uxObserver({
    operations,
    selection,
    probes: [
      { id: "discover", atStateId: "arrival", targetGraphNodeId: "accept" },
    ],
    artifacts,
  });
  const locator = {
    count: async () => 1,
    isVisible: async () => true,
    boundingBox: async () => ({ x: 10, y: 20, width: 30, height: 40 }),
  };
  const observation = {
    stage: "state-asserted",
    operation: operations[1],
    execution: {
      runId: "run-a",
      executionId: "execution",
      profile: { id: "default" },
    },
    page: {
      getByRole: () => locator,
      viewportSize: () => ({ width: 1440, height: 1000 }),
    },
  } as unknown as PlaywrightOperationObservation;
  await observer.observeOperation!(observation);
  assert.equal(observer.evidence[0].inViewport, true);
  const snapshot = observer.evidence;
  await observer.observeOperation!(observation);
  assert.equal(snapshot.length, 1);
  const execution = result();
  const before = JSON.stringify(execution);
  await observer.report({ result: execution, json: before });
  assert.equal(JSON.stringify(execution), before);
  assert.equal(JSON.parse(writes[0]).runId, execution.runId);
  assert.ok(!writes[0].includes("getByRole"));
});

test("pure entrypoint has no runtime, application, or reporting imports", async () => {
  const source = await readFile(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /import\s+(?!type\b)/);
  assert.doesNotMatch(
    source,
    /process\.|Date\.|performance\.|nextcloud|axe|react|playwright/,
  );
});
