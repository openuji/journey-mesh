import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyPlanOperation } from "@openuji/journey-execution-model";
import type { RunResult } from "@openuji/journey-runner";
import { deriveUXOutput, validateUXConfiguration, type UXConfiguration, type UXGeometry, type UXObservation } from "../src/index.js";

const state = (id: string): JourneyPlanOperation => ({
  id, sequence: 0, kind: "state", actorId: "learner", touchpointId: "campus", entry: { id: "entry", stateId: id }, segment: "tour",
  state: { id }, surface: { id: "surface" },
  target: { expectedMatchCount: 1, bindings: [], observation: { stateId: id, surfaceId: "surface", expectedMatchCount: 1, bindings: [] } }
});
const operations = [state("footer-step"), state("orphaned-step")];
const config = (expect?: UXConfiguration["probes"][number]["expect"]): UXConfiguration => ({
  id: "tour", operations, counters: [], checkpoints: [],
  probes: [{ id: "dialog", label: "Tour dialog", at: "orphaned-step", target: "orphaned-step", ...(expect ? { expect } : {}) }]
});
const result = (reached = operations): RunResult => ({
  ok: true, runId: "run", plan: { id: "plan" }, errors: [], assessments: [], executions: [{ executionId: "pointer-01", profileId: "pointer", outcome: { kind: "passed" } }],
  evidence: { executions: [{ executionId: "pointer-01", profileId: "pointer", operations: reached.map((op) => ({ operationId: op.id, operationKind: op.kind, outcome: { kind: "passed" as const } })) }] }
});
const geometry = (overrides: Partial<UXGeometry> = {}): UXGeometry => ({
  matches: 1, rect: { x: 312, y: 200, width: 400, height: 240 }, viewport: { width: 1024, height: 768 }, scroll: { x: 0, y: 1840 }, stable: true, ...overrides
});
const fact = (overrides: Partial<UXObservation> = {}): UXObservation => ({
  runId: "run", executionId: "pointer-01", profileId: "pointer", operationId: "orphaned-step", probeId: "dialog", targetOperationId: "orphaned-step",
  visible: true, inViewport: true, geometry: geometry(), ...overrides
});
const derive = (expect: UXConfiguration["probes"][number]["expect"], observations: readonly UXObservation[], reached = operations) =>
  deriveUXOutput({ ...config(expect), result: result(reached), actions: [], observations });

test("a probe without expectations stays informational, and every probe reports the page scroll", () => {
  const output = derive(undefined, [fact({ inViewport: false, geometry: geometry({ rect: { x: 312, y: 900, width: 400, height: 240 } }) })]);
  assert.deepEqual(output.errors, []);
  assert.deepEqual(output.measurements.map((item) => [item.id, item.value]), [["dialog/visible", true], ["dialog/inViewport", false], ["dialog/scrollY", 1840]]);
});

test("a visible dialog outside the viewport fails inViewport with its measured geometry", () => {
  const offscreen = fact({ inViewport: false, geometry: geometry({ rect: { x: 312, y: 900, width: 400, height: 240 } }) });
  const { errors } = derive(["visible", "inViewport"], [offscreen]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.name, "UXExpectationFailed");
  assert.match(errors[0]!.message, /Probe dialog in execution pointer-01: expected inViewport, but the target \(x 312, y 900, 400×240\) is not contained in the 1024×768 viewport/);
  assert.deepEqual(derive(["visible", "inViewport"], [fact()]).errors, []);
});

test("missing, ambiguous or unstable observations cannot satisfy an expectation", () => {
  const messages = (observation: UXObservation) => derive(["visible"], [observation]).errors.map((error) => error.message);
  assert.match(messages(fact({ visible: false, geometry: geometry({ matches: 2, rect: null }) }))[0]!, /matched 2 elements, not exactly one/);
  assert.match(messages(fact({ geometry: geometry({ stable: false }) }))[0]!, /did not stabilize/);
  assert.match(messages(fact({ geometry: undefined }))[0]!, /no geometry was observed/);
  assert.match(derive(["visible"], []).errors[0]!.message, /the probe was not observed/);
  // A state the execution never reached fails the execution, not the probe.
  assert.deepEqual(derive(["visible"], [], operations.slice(0, 1)).errors, []);
});

test("scrolled requires a vertically scrolled page", () => {
  assert.deepEqual(derive(["scrolled"], [fact()]).errors, []);
  assert.match(derive(["scrolled"], [fact({ geometry: geometry({ scroll: { x: 0, y: 0 } }) })]).errors[0]!.message, /expected scrolled, but the page is not scrolled \(scrollY 0\)/);
});

test("unknown expectations are rejected before execution", () => {
  assert.throws(() => validateUXConfiguration(config(["centered" as never])), /unknown expectation centered/);
});
