import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyInputAction } from "@openuji/journey-core";
import type { JourneyPlanOperation } from "@openuji/journey-execution-model";
import { operabilityEvidenceFormat } from "@openuji/journey-observer-operability/evidence";
import { buildOperabilityReport, journeyMeshInterpreter, operabilityReportFormat } from "../src/index.js";

const keyboard = { id: "observability:keyboard" };
const pointer = { id: "observability:pointer" };
const textEntry = { id: "urn:openuji:input-modality:keyboard-text-entry" };
const tab = { id: "urn:locator:drafts-tab", role: "tab", accessibleName: "Drafts", features: [], contexts: [] };

const transition = (id: string, sequence: number, phaseId: string, materializations: unknown[] = []) => ({
  id, sequence, kind: "transition", segment: "pages", actorId: "owner", touchpointId: "web",
  entry: { id: "entry", stateId: "start" }, source: { references: { phaseId } },
  transition: { id: `urn:transition:${id}`, label: `Transition ${id}`, from: "a", to: "b" },
  activation: { transitionId: `urn:transition:${id}`, requiredInputModalityProfiles: [] }, materializations
}) as unknown as JourneyPlanOperation;

const plan = {
  id: "plan",
  operations: [
    transition("login", 0, "urn:phase:setup"),
    { id: "drafts-state", sequence: 1, kind: "state" },
    transition("select-drafts", 2, "urn:phase:pages", [
      { id: "urn:material:keyboard", label: "Tab to the tab list, then arrow", transitionId: "urn:transition:select-drafts", modality: keyboard, steps: [
        { id: "urn:step:k1", kind: "move", moveKind: { id: "operability:nextStop", type: "focus" } },
        { id: "urn:step:k2", kind: "move", moveKind: { id: "operability:nextItem", type: "focus" }, locator: tab },
        { id: "urn:step:k3", kind: "activation" }
      ] },
      { id: "urn:material:pointer", transitionId: "urn:transition:select-drafts", modality: pointer, steps: [
        { id: "urn:step:p1", kind: "move", moveKind: { id: "operability:pointAt", type: "move" }, locator: tab },
        { id: "urn:step:p2", kind: "activation" }
      ] }
    ]),
    transition("enter-title", 3, "urn:phase:pages")
  ]
} as never;

const action = (executionId: string, operationId: string, id: string, status: JourneyInputAction["status"], extra: Partial<JourneyInputAction>): JourneyInputAction => ({
  id, runId: "run", executionId, profileId: executionId, operationId, modalityId: "m", command: "move", unit: "adapter-command", status, ...extra
});

const result = {
  runId: "run", plan: { id: "plan" }, ok: false, assessments: [], errors: [],
  executions: [{ executionId: "keyboard-only", profileId: "keyboard-only" }, { executionId: "default", profileId: "default" }],
  evidence: { executions: [
    { executionId: "keyboard-only", profileId: "keyboard-only", operations: [
      { operationId: "login", operationKind: "transition", outcome: { kind: "passed" } },
      { operationId: "select-drafts", operationKind: "transition", outcome: { kind: "failed", error: { name: "Error", message: "focus did not move" } } }
    ] },
    { executionId: "default", profileId: "default", operations: [
      { operationId: "select-drafts", operationKind: "transition", outcome: { kind: "passed" } },
      { operationId: "enter-title", operationKind: "transition", outcome: { kind: "passed" } }
    ] }
  ] }
} as never;

const evidence = {
  format: operabilityEvidenceFormat as typeof operabilityEvidenceFormat, version: 1 as const,
  decisions: [
    { runId: "run", executionId: "keyboard-only", profileId: "keyboard-only", operationId: "select-drafts", inputModalityProfileId: "urn:p:keyboard", modalityId: keyboard.id, materializationId: "urn:material:keyboard" },
    { runId: "run", executionId: "default", profileId: "default", operationId: "select-drafts", inputModalityProfileId: "urn:p:pointer", modalityId: pointer.id, materializationId: "urn:material:pointer" },
    { runId: "run", executionId: "default", profileId: "default", operationId: "enter-title", inputModalityProfileId: "urn:p:text", modalityId: textEntry.id }
  ],
  actions: [
    action("keyboard-only", "select-drafts", "k/0", "completed", { stepId: "urn:step:k1", gesture: "Tab" }),
    action("keyboard-only", "select-drafts", "k/1", "failed", { stepId: "urn:step:k2", gesture: "ArrowRight", error: { name: "Error", message: "focus did not move" } }),
    action("default", "select-drafts", "d/0", "completed", { stepId: "urn:step:p1", gesture: "pointer-move" }),
    action("default", "select-drafts", "d/1", "completed", { stepId: "urn:step:p2", gesture: "pointer-press", command: "activate" }),
    action("default", "enter-title", "d/2", "completed", { command: "text-entry", gesture: "type" })
  ]
};

test("each transition shows its declared steps with the key used and the outcome, per profile", () => {
  const report = buildOperabilityReport({ observerId: "input-steps", test: { plan, result }, evidence, excludedPhaseIds: ["urn:phase:setup"] });
  assert.equal(report.format, operabilityReportFormat);
  const [keyboardRun, defaultRun] = report.executions;
  assert.deepEqual(keyboardRun!.transitions.map((item) => item.operationId), ["select-drafts", "enter-title"], "setup phases are left out");
  const selected = keyboardRun!.transitions[0]!;
  assert.equal(selected.outcome, "failed");
  assert.equal(selected.error, "focus did not move");
  assert.deepEqual(selected.input, { modalityId: keyboard.id, inputModalityProfileId: "urn:p:keyboard", materialization: { id: "urn:material:keyboard", label: "Tab to the tab list, then arrow" } });
  assert.deepEqual(selected.steps.map((step) => [step.position, step.kind, step.moveKindId, step.gesture, step.status]), [
    [1, "move", "operability:nextStop", "Tab", "completed"],
    [2, "move", "operability:nextItem", "ArrowRight", "failed"],
    [3, "activation", undefined, undefined, "not-performed"]
  ]);
  assert.deepEqual(selected.steps[1]!.locator, { id: "urn:locator:drafts-tab", role: "tab", name: "Drafts" });
  assert.equal(selected.steps[1]!.error, "focus did not move");
  assert.equal(keyboardRun!.transitions[1]!.outcome, "not-executed");
  assert.equal(keyboardRun!.transitions[1]!.input, undefined);

  assert.deepEqual(defaultRun!.transitions[0]!.steps.map((step) => step.gesture), ["pointer-move", "pointer-press"]);
  const typed = defaultRun!.transitions[1]!;
  assert.equal(typed.input?.materialization, undefined);
  assert.deepEqual(typed.steps.map((step) => [step.kind, step.gesture, step.status]), [["text-entry", "type", "completed"]]);
  assert.deepEqual(report.summary, { transitions: 4, materialized: 2, steps: 6, failedSteps: 1 });
  assert.ok(Object.isFrozen(report.executions));
});

test("the interpreter publishes one labelled data document and no node metrics", async () => {
  const output = { id: "input-steps", kind: "operability", measurements: [], evidence, errors: [] };
  const interpretation = await journeyMeshInterpreter.interpret({ test: { plan, result } as never, output, excludedPhaseIds: [], read: async () => new Uint8Array(), readJson: async () => ({}) as never }, undefined);
  assert.equal(interpretation.nodes, undefined);
  assert.deepEqual(interpretation.data?.map((item) => [item.name, item.format, item.label]), [["operability.json", operabilityReportFormat, "Input steps"]]);
  await assert.rejects(async () => journeyMeshInterpreter.interpret({ test: { plan, result } as never, output: { ...output, evidence: {} }, excludedPhaseIds: [], read: async () => new Uint8Array(), readJson: async () => ({}) as never }, undefined), /has no recorded operability evidence/);
});
