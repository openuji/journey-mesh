import assert from "node:assert/strict";
import test from "node:test";
import { stepPosition, type ResolvedMaterializationStep, type ResolvedTransitionMaterialization, type TransitionPlanOperation } from "@openuji/journey-execution-model";
import { defaultPlaywrightKeyboard, parsePlaywrightKeyboard, playwrightExecutor, validatePlaywrightMaterializations } from "../src/index.js";

const client = Object.freeze({ name: "client", resolveEntry: () => Object.freeze({ kind: "url" as const, url: "https://example.test/" }), resolveTransitionValue: () => undefined });
const tab = { id: "urn:locator:drafts", role: "tab", accessibleName: "Drafts", features: [], contexts: [] };
const move = (id: string, kind: string, type: "focus" | "move" = "focus", locator?: typeof tab): ResolvedMaterializationStep =>
  ({ id, kind: "move", moveKind: { id: kind, type }, ...(locator ? { locator } : {}) });
const activation: ResolvedMaterializationStep = { id: "urn:step:activate", kind: "activation" };

const operation = (modality: string, steps: readonly ResolvedMaterializationStep[]) => ({
  kind: "transition", transition: { id: "urn:transition:select-drafts" },
  activation: { requiredInputModalityProfiles: [] },
  materializations: [{ id: "urn:material", transitionId: "urn:transition:select-drafts", modality: { id: modality }, steps }]
}) as unknown as TransitionPlanOperation;

const rejects = (modality: string, steps: readonly ResolvedMaterializationStep[], message: RegExp, keyboard = defaultPlaywrightKeyboard) =>
  assert.throws(() => validatePlaywrightMaterializations(operation(modality, steps), keyboard), message);

test("performable keyboard, pointer, and text-entry materializations pass preflight", () => {
  for (const [modality, steps] of [
    ["observability:keyboard", [move("1", "operability:nextStop"), move("2", "operability:nextItem", "focus", tab), activation]],
    ["observability:pointer", [move("1", "operability:pointAt", "move", tab), activation]],
    ["observability:keyboard", [{ id: "s", kind: "shortcut", locator: tab }]],
    ["observability:keyboard", [{ id: "s", kind: "shortcut", extensions: { "urn:openuji:playwright:shortcut": { keys: "Control+K" } } }]],
    ["urn:openuji:input-modality:keyboard-text-entry", [move("1", "operability:nextStop")]],
    ["urn:openuji:input:touch-tap", [{ id: "s", kind: "move" }]]
  ] as const) {
    assert.doesNotThrow(() => validatePlaywrightMaterializations(operation(modality, steps), defaultPlaywrightKeyboard), `${modality}`);
  }
});

test("preflight rejects steps the executor would have to complete or guess", () => {
  rejects("observability:keyboard", [{ id: "urn:step:1", kind: "move" }, activation], /Materialization urn:material step urn:step:1: a MoveStep without stepMoveKindRef cannot be performed/);
  rejects("observability:pointer", [move("urn:step:1", "operability:pointAt", "move"), activation], /must name its object with stepLocatorRef/);
  rejects("observability:pointer", [move("urn:step:1", "operability:nextPage", "move"), activation], /does not support operability:nextPage through observability:pointer; it performs FocusMoveKind moves, and operability:pointAt through observability:pointer/);
  rejects("observability:keyboard", [move("urn:step:1", "operability:nextPage", "move")], /does not support operability:nextPage through observability:keyboard/);
  // The kind's type, not its IRI, says it moves focus; the modality says whether that is allowed.
  rejects("observability:pointer", [move("urn:step:1", "operability:nextStop"), activation], /does not support operability:nextStop through observability:pointer/);
  rejects("observability:keyboard", [move("urn:step:1", "operability:pointAt", "move", tab), activation], /does not support operability:pointAt through observability:keyboard/);
  rejects("observability:keyboard", [move("urn:step:1", "urn:producer:nextHeading", "move")], /does not support urn:producer:nextHeading through observability:keyboard/);
  rejects("observability:keyboard", [move("urn:step:1", "urn:producer:nextHeading")], /no key for urn:producer:nextHeading; set executors.<name>.options.keyboard.moves/);
  rejects("observability:keyboard", [{ id: "urn:step:1", kind: "shortcut" }], /needs an object that exposes its shortcut/);
  rejects("observability:keyboard", [{ id: "urn:step:1", kind: "shortcut", extensions: { "urn:openuji:playwright:shortcut": "Control+K" } }], /must be an object with a nonempty keys string/);
  rejects("observability:pointer", [{ id: "urn:step:1", kind: "shortcut", locator: tab }], /ShortcutSteps only through observability:keyboard/);
  rejects("urn:openuji:input-modality:keyboard-text-entry", [move("1", "operability:nextStop"), activation], /only reaches the field with focus moves; activation steps are not supported/);
  rejects("observability:keyboard", [move("1", "operability:nextStop", "focus", { ...tab, role: "not-a-role" })], /Unsupported Playwright role/);
});

test("a producer move kind is performable once mesh.yaml names its key", () => {
  const keyboard = parsePlaywrightKeyboard({ moves: { "urn:producer:nextHeading": "h" } });
  assert.doesNotThrow(() => validatePlaywrightMaterializations(operation("observability:keyboard", [move("1", "urn:producer:nextHeading"), activation]), keyboard));
});

test("the executor runs materialization preflight in describeOperation", () => {
  const executor = playwrightExecutor({ client });
  assert.throws(() => executor.describeOperation!(operation("observability:keyboard", [{ id: "urn:step:1", kind: "move" }])), /without stepMoveKindRef/);
});

test("a step's position comes from the move kinds before it, and the modality only before any move", () => {
  const material = (modality: string, steps: readonly ResolvedMaterializationStep[]) =>
    ({ id: "urn:material", transitionId: "urn:transition", modality: { id: modality }, steps }) as ResolvedTransitionMaterialization;
  const positions = (modality: string, steps: readonly ResolvedMaterializationStep[]) => steps.map((step) => stepPosition(material(modality, steps), step));
  // A keyboard path: focus moves, then the activation where they left focus.
  assert.deepEqual(positions("observability:keyboard", [move("1", "operability:nextStop"), move("2", "urn:producer:nextHeading"), activation]), ["focus", "focus", "focus"]);
  // A pointer click.
  assert.deepEqual(positions("observability:pointer", [move("1", "operability:pointAt", "move", tab), activation]), ["pointer", "pointer"]);
  // A page move moves neither focus nor the pointer: the activation after it stays where the user was.
  assert.deepEqual(positions("observability:keyboard", [move("1", "operability:nextStop"), move("2", "operability:nextPage", "move"), activation]), ["focus", "other", "focus"]);
  // Before any move, the user is at the pointer in a pointer materialization and at focus otherwise.
  assert.deepEqual(positions("observability:pointer", [activation]), ["pointer"]);
  assert.deepEqual(positions("observability:keyboard", [activation]), ["focus"]);
  assert.deepEqual(positions("observability:keyboard", [{ id: "s", kind: "shortcut", locator: tab }]), ["focus"]);
});
