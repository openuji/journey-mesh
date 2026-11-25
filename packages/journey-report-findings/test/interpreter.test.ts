import assert from "node:assert/strict";
import test from "node:test";
import type { JourneyInputAction } from "@openuji/journey-core";
import type { ResolvedMaterializationStep } from "@openuji/journey-execution-model";
import {
  findingsEvidenceFormat,
  type ElementFact,
  type FailureCapture,
  type FindingsEvidence
} from "@openuji/journey-observer-findings/evidence";
import type { TestRecord } from "@openuji/journey-run-record";
import { buildFindingsReport, collapseKeys, findingsReportFormat, journeyMeshInterpreter, type Finding } from "../src/index.js";

const setup = "urn:phase:setup";
const pageActions = { id: "urn:locator:page-actions", role: "button", accessibleName: "Page actions", features: [], contexts: [] };
const tableOption = { id: "urn:locator:table", role: "option", accessibleName: "Table or view", features: [], contexts: [] };
/** Steps as the model types them: the move kind's type, never its IRI, says whether a step is about focus. */
const focusMove = (id: string, locator?: typeof pageActions): ResolvedMaterializationStep => ({ id, kind: "move", moveKind: { id: "operability:nextStop", type: "focus" }, ...(locator ? { locator } : {}) });
const pointAt = (id: string, locator: typeof pageActions): ResolvedMaterializationStep => ({ id, kind: "move", moveKind: { id: "operability:pointAt", type: "move" }, locator });
const activation = (id: string, locator?: typeof pageActions): ResolvedMaterializationStep => ({ id, kind: "activation", ...(locator ? { locator } : {}) });
const materializations: Record<string, { modality: string; steps: ResolvedMaterializationStep[] }> = {
  open: { modality: "observability:keyboard", steps: [focusMove("urn:step:open:1", pageActions), activation("urn:step:open:2", pageActions)] },
  save: { modality: "observability:keyboard", steps: [focusMove("urn:step:save:1"), activation("urn:step:save:2")] },
  choose: { modality: "observability:pointer", steps: [pointAt("urn:step:choose:1", tableOption), activation("urn:step:choose:2")] }
};
const op = (id: string, sequence: number, kind: "state" | "transition", label: string, phaseId = "urn:phase:pages") => ({
  id, sequence, kind, segment: "pages", source: { references: { phaseId, originalOperationId: `urn:ujg:document:tables:op:${String(sequence).padStart(3, "0")}:${id}` } },
  ...(kind === "state"
    ? { state: { id: `urn:state:${id}`, label }, target: { expectedMatchCount: 1, bindings: [{ locators: [{ id: `urn:locator:${id}`, role: "region", accessibleName: label, features: [], contexts: [] }] }] } }
    : { transition: { id: `urn:transition:${id}`, label, from: "a", to: "b" },
      ...(materializations[id] ? { materializations: [{ id: `urn:materialization:${id}`, transitionId: `urn:transition:${id}`, modality: { id: materializations[id]!.modality }, steps: materializations[id]!.steps }] } : {}) })
});
const operations = [
  op("login", 0, "transition", "Log in", setup),
  op("home", 1, "state", "The page is shown"),
  op("open", 2, "transition", "Open Page actions"),
  op("menu", 3, "state", "The menu is open"),
  op("save", 4, "transition", "Save details"),
  op("saved", 5, "state", "Details are saved"),
  op("choose", 6, "transition", "Choose Table or view"),
  op("form", 7, "state", "The table widget settings are shown")
];

const box = (x: number) => ({ x, y: 100, width: 80, height: 30 });
const fact = (role: string, name: string, extra: Partial<ElementFact> = {}): ElementFact => ({ matches: 1, visible: true, role, name, box: box(10), inViewport: true, markup: `<x>${name}</x>`, ...extra });
const shot = (name: string) => ({ href: `tests/t/files/${name}.png`, viewport: { width: 1600, height: 1000 }, scale: 1 });

const executions = (runId: string) => [
  { executionId: `keyboard-only-${runId}`, profileId: "keyboard-only" },
  { executionId: `default-${runId}`, profileId: "default" }
];

function record(runId: string, evidence: FindingsEvidence, failAt = "form"): TestRecord {
  const failedAt = operations.find((item) => item.id === failAt)!.sequence;
  return {
    id: "page-arrange", plan: { id: "plan", operations },
    result: {
      ok: false, runId, plan: { id: "plan" }, assessments: [], errors: [],
      executions: executions(runId).map((execution) => ({ ...execution, outcome: { kind: "failed" } })),
      evidence: { executions: executions(runId).map((execution) => ({ ...execution, operations: operations.filter((item) => item.sequence <= failedAt).map((item) => ({
        operationId: item.id, operationKind: item.kind,
        outcome: item.id === failAt ? { kind: "failed", error: { name: "Error", message: "Expected locator count 1; last value: count:0" } } : { kind: "passed" }
      })) })) }
    },
    files: executions(runId).flatMap((execution) => [
      { name: `${execution.profileId}-005-saved.source.playwright-screenshot.png`, href: `tests/t/files/${execution.profileId}-005-saved.png`, contentType: "image/png", scope: { runId, executionId: execution.executionId, profileId: execution.profileId, operationId: "saved" } }
    ])
  } as unknown as TestRecord;
}

function evidence(runId: string, failures: FailureCapture[] = targetMissing(runId)): FindingsEvidence {
  const [keyboard] = executions(runId);
  const actions: JourneyInputAction[] = [
    ["login", "type"], ["open", "Tab"], ["open", "Tab"], ["open", "Tab"], ["open", "Space"], ["save", "Tab"], ["save", "Space"], ["choose", "Enter"]
  ].map(([operationId, gesture], index) => ({ id: `${keyboard!.executionId}/action/${index}`, runId, ...keyboard!, operationId: operationId!, modalityId: "keyboard", command: "move", unit: "adapter-command", status: "completed", gesture }));
  return { format: findingsEvidenceFormat, version: 1, problems: [], failures, actions };
}

function targetMissing(runId: string): FailureCapture[] {
  return executions(runId).map((execution) => ({
    runId, ...execution, operationId: "form", error: { name: "Error", message: "Expected locator count 1; last value: count:0" },
    expected: { kind: "state", role: "combobox", name: "Table or view", context: { role: "dialog", name: "Add widget" }, expectedCount: 1, count: 0 },
    candidates: [
      { ...fact("combobox", "Table o r view", { box: box(300) }), sameIgnoringWhitespace: true },
      { ...fact("combobox", "Widget type", { box: box(100) }), sameIgnoringWhitespace: false }
    ],
    snapshot: { screenshot: shot(`failure-${execution.profileId}`), focus: fact("option", "Table or view") }
  }));
}

const build = (runId: string, failures?: FailureCapture[], failAt?: string) =>
  buildFindingsReport({ observerId: "findings", test: record(runId, evidence(runId, failures), failAt), evidence: evidence(runId, failures), excludedPhaseIds: [setup] });
const byId = (findings: readonly Finding[], id: string) => findings.find((finding) => finding.id === id)!;

test("a failure is one finding across profiles, with the last confirmed state and the closest elements", () => {
  const finding = byId(build("r1").findings, "page-arrange--form");
  assert.equal(finding.failureClass, "target-missing");
  assert.equal(finding.title, `Combobox "Table or view" is named "Table o r view" in the dialog "Add widget"`, "the closest element is named in the title");
  assert.equal(finding.expected, `A combobox "Table or view" in the dialog "Add widget" ("The table widget settings are shown").`);
  assert.match(finding.observed, /Found instead: combobox "Table o r view", combobox "Widget type"\. Combobox "Table o r view" differs from the expected name only in spacing\./);
  assert.deepEqual(finding.frames.map((item) => [item.key, item.label, item.screenshot, item.fullPage]), [
    ["before", `Last confirmed: "Details are saved"`, "tests/t/files/keyboard-only-005-saved.png", true],
    ["failure", `At failure: "The table widget settings are shown"`, "tests/t/files/failure-keyboard-only.png", false]
  ]);
  assert.deepEqual(finding.frames[1]!.marks.map((mark) => [mark.tone, mark.label]), [["problem", `combobox "Table o r view"`], ["context", `combobox "Widget type"`]]);
  assert.equal(finding.error, "Expected locator count 1; last value: count:0");
});

test("steps to reproduce leave out the setup and collapse repeated keys", () => {
  const finding = byId(build("r1").findings, "page-arrange--form");
  assert.deepEqual(finding.reproduce, [
    { label: "Complete the setup (1 step, left out of this report)" },
    { label: "Open Page actions", keys: "Tab ×3, Space" },
    { label: "Save details", keys: "Tab, Space" },
    { label: "Choose Table or view", keys: "Enter" }
  ]);
  assert.equal(collapseKeys(["Tab", "Tab", "Space", "Tab"]), "Tab ×2, Space, Tab");
  assert.equal(collapseKeys(["pointer-move", "pointer-press", "type", "pointer-move", "pointer-press"]), "click, type, click");
});

test("finding ids stay the same across runs, so a report names the same finding run after run", () => {
  assert.deepEqual(build("r1").findings.map((finding) => finding.id), build("r2").findings.map((finding) => finding.id));
});

test("each failure class is decided from the captured facts, not from the error text", () => {
  const failure = (operationId: string, overrides: Partial<FailureCapture>): FailureCapture[] => [{
    runId: "r3", executionId: "keyboard-only-r3", profileId: "keyboard-only", operationId, error: { name: "Error", message: "something" },
    candidates: [], snapshot: { screenshot: shot("failure"), focus: null }, ...overrides
  }];
  const only = (operationId: string, overrides: Partial<FailureCapture>) => build("r3", failure(operationId, overrides), operationId).findings[0]!;
  const ambiguous = only("menu", { expected: { kind: "state", role: "menu", name: "Page actions", expectedCount: 1, count: 2 } });
  assert.equal(ambiguous.failureClass, "target-ambiguous");
  assert.equal(ambiguous.title, `2 elements match menu "Page actions"`);
  const other = only("menu", { error: { name: "AxeError", message: "audit failed\nstack" } });
  assert.equal(other.failureClass, "other");
  assert.equal(other.frames.at(-1)!.banner, "audit failed");
  assert.equal(other.id, "page-arrange--menu");
});

test("a focus finding is a failed step whose move kind is about focus, and says what focus was to do", () => {
  const failure = (operationId: string, stepId: string, overrides: Partial<FailureCapture>): FailureCapture[] => [{
    runId: "r5", executionId: "keyboard-only-r5", profileId: "keyboard-only", operationId, stepId, error: { name: "Error", message: "something" },
    candidates: [], snapshot: { screenshot: shot("failure"), focus: null }, ...overrides
  }];
  const only = (operationId: string, stepId: string, overrides: Partial<FailureCapture>) => build("r5", failure(operationId, stepId, overrides), operationId).findings[0]!;
  const expectedFocus = { kind: "focus" as const, role: "button", name: "Page actions", expectedCount: 1, count: 1 };
  const target = fact("button", "Page actions", { box: box(700) });

  // A FocusMoveKind step with a locator: focus was to reach the object.
  const reach = only("open", "urn:step:open:1", { gesture: "Tab", expected: expectedFocus, target });
  assert.equal(reach.failureClass, "focus-mismatch");
  assert.equal(reach.title, `Focus does not reach button "Page actions" in "Open Page actions"`);
  assert.equal(reach.expected, `Focus moves to button "Page actions" with Tab.`);
  assert.deepEqual([reach.frames.at(-1)!.banner, reach.frames.at(-1)!.marks.map((mark) => mark.tone)], ["No element has focus", ["expected"]]);

  // An activation reached by focus: focus was to be on the object already, e.g. returned after a dialog.
  const at = only("open", "urn:step:open:2", { expected: expectedFocus, target });
  assert.equal(at.title, `Focus is not on button "Page actions" in "Open Page actions"`);
  assert.equal(at.observed, "No element has focus: the document has it.");

  // A focus move without a locator: focus was to move at all.
  const stuck = only("save", "urn:step:save:1", { gesture: "Tab", expected: { kind: "focus", expectedCount: 1 }, snapshot: { screenshot: shot("failure"), focus: fact("button", "Save", { box: box(300) }) } });
  assert.equal(stuck.title, `Focus does not move in "Save details"`);
  assert.equal(stuck.expected, "Focus moves with Tab.");
  assert.equal(stuck.observed, `Focus stays on button "Save".`);
  assert.deepEqual(stuck.frames.at(-1)!.marks.map((mark) => [mark.tone, mark.label]), [["problem", `focus: button "Save"`]]);

  // A pointAt step is about the pointer: a missing object, never a focus finding.
  const pointer = only("choose", "urn:step:choose:1", { gesture: "pointer-move", expected: { kind: "pointer", role: "option", name: "Table or view", expectedCount: 1, count: 0 } });
  assert.equal(pointer.failureClass, "target-missing");
  assert.equal(pointer.title, `Option "Table or view" not found`);
});

test("a failure in a phase the report leaves out (setup) is not a finding", () => {
  const login: FailureCapture = { runId: "r6", executionId: "keyboard-only-r6", profileId: "keyboard-only", operationId: "login", error: { name: "Error", message: "timeout" }, candidates: [], snapshot: { focus: null } };
  assert.deepEqual(build("r6", [login], "login").findings, []);
});

test("the interpreter rejects output that is not the findings observer's and emits one data document", async () => {
  const runId = "r1";
  const output = { id: "findings", kind: "findings", measurements: [], errors: [], evidence: evidence(runId) };
  const interpretation = await journeyMeshInterpreter.interpret({ test: record(runId, evidence(runId)), output, excludedPhaseIds: [setup], read: async () => new Uint8Array(), readJson: async () => ({}) as never }, undefined);
  assert.deepEqual(interpretation.data?.map((item) => [item.name, item.format]), [["findings.json", findingsReportFormat]]);
  await assert.rejects(async () => journeyMeshInterpreter.interpret({ test: record(runId, evidence(runId)), output: { ...output, evidence: {} }, excludedPhaseIds: [], read: async () => new Uint8Array(), readJson: async () => ({}) as never }, undefined), /no recorded findings evidence/);
});


test("steps to reproduce stop at the failed step, without what a fallback pressed after it", () => {
  const failure = (operationId: string, stepId: string): FailureCapture => ({
    runId: "r7", executionId: "keyboard-only-r7", profileId: "keyboard-only", operationId, stepId, error: { name: "Error", message: "something" },
    expected: { kind: "focus", role: "button", name: "Page actions", expectedCount: 1, count: 1 }, candidates: [], snapshot: { screenshot: shot("failure"), focus: null }
  });
  const action = (index: number, operationId: string, stepId: string, status: JourneyInputAction["status"], gesture?: string): JourneyInputAction => ({
    id: `keyboard-only-r7/action/${index}`, runId: "r7", executionId: "keyboard-only-r7", profileId: "keyboard-only",
    operationId, stepId, modalityId: "keyboard", command: "move", unit: "adapter-command", status, ...(gesture ? { gesture } : {})
  });
  // Each canonical step fails; the fallback then takes the transition, and the journey fails again later.
  const failures = [failure("open", "urn:step:expected:open"), failure("save", "urn:step:expected:save")];
  const recorded: FindingsEvidence = { format: findingsEvidenceFormat, version: 1, problems: [], failures, actions: [
    action(0, "open", "urn:step:expected:open", "failed"),
    action(1, "open", "urn:step:open:1", "completed", "Tab"),
    action(2, "open", "urn:step:open:2", "completed", "Space"),
    action(3, "save", "urn:step:expected:save", "failed"),
    action(4, "save", "urn:step:save:1", "completed", "Tab")
  ] };
  const report = buildFindingsReport({ observerId: "findings", test: record("r7", recorded, "form"), evidence: recorded, excludedPhaseIds: [setup] });
  assert.deepEqual(report.findings.map((finding) => finding.reproduce.slice(1)), [
    [{ label: "Open Page actions" }],
    [{ label: "Open Page actions", keys: "Tab, Space" }, { label: "Save details" }]
  ]);
});
