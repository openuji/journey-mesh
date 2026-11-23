import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvedMaterializationStep, TransitionPlanOperation } from "@openuji/journey-execution-model";
import { defaultPlaywrightKeyboard, parsePlaywrightKeyboard, playwrightAdapter, validatePlaywrightMaterializations } from "../src/index.js";

const driver = Object.freeze({ name: "driver", resolveEntry: () => Object.freeze({ kind: "url" as const, url: "https://example.test/" }), resolveTransitionValue: () => undefined });
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

test("preflight rejects steps the adapter would have to complete or guess", () => {
  rejects("observability:keyboard", [{ id: "urn:step:1", kind: "move" }, activation], /Materialization urn:material step urn:step:1: a MoveStep without stepMoveKindRef cannot be performed/);
  rejects("observability:pointer", [move("urn:step:1", "operability:pointAt", "move"), activation], /must name its object with stepLocatorRef/);
  rejects("observability:pointer", [move("urn:step:1", "operability:nextPage", "move"), activation], /does not support operability:nextPage through observability:pointer/);
  rejects("observability:keyboard", [move("urn:step:1", "operability:nextPage", "move")], /only focus moves are performed/);
  rejects("observability:keyboard", [move("urn:step:1", "urn:producer:nextHeading")], /no key for urn:producer:nextHeading; set adapters.<name>.options.keyboard.moves/);
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

test("the adapter runs materialization preflight in describeOperation", () => {
  const adapter = playwrightAdapter({ driver });
  assert.throws(() => adapter.describeOperation!(operation("observability:keyboard", [{ id: "urn:step:1", kind: "move" }])), /without stepMoveKindRef/);
});
