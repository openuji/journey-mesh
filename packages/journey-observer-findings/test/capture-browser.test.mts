import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import type { JourneyInputAction } from "@openuji/journey-core";
import type { ResolvedAccessibleLocator, ResolvedMaterializationStep, ResolvedTransitionMaterialization } from "@openuji/journey-execution-model";
import type { JourneyArtifact, JourneyArtifactStore } from "@openuji/journey-plugin";
import type { FindingsEvidence } from "../src/evidence.js";
import { findingsObserver } from "../src/playwright.js";

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const keyboard = "observability:keyboard";
const pointer = "observability:pointer";
const profiles = [{ id: keyboard, modalities: [{ id: keyboard }] }];

const locator = (id: string, role: string, accessibleName: string, contexts: ResolvedAccessibleLocator[] = []): ResolvedAccessibleLocator =>
  ({ id, role, accessibleName, features: [{ id: `${id}:exact`, name: "accessible-name-exact", value: "true" }], contexts });
const binding = (name: string, target: ResolvedAccessibleLocator, required: unknown[] = []) =>
  ({ id: `urn:obs:${name}`, surfaceId: `urn:surface:${name}`, eventId: "urn:observation-event:presence", requiredInputModalityProfiles: required, locators: [target] });
const state = (name: string, sequence: number, target: ResolvedAccessibleLocator) => ({
  id: `state-${name}`, sequence, kind: "state", segment: "main", actorId: "actor", touchpointId: "touchpoint",
  entry: { id: "entry", stateId: "urn:state:first" }, entryBinding: { id: "entry-binding", value: "page" },
  state: { id: `urn:state:${name}`, label: name }, surface: { id: `urn:surface:${name}` },
  target: { expectedMatchCount: 1, bindings: [binding(name, target)], observation: { stateId: `urn:state:${name}`, surfaceId: `urn:surface:${name}`, expectedMatchCount: 1, bindings: [binding(name, target)] } }
});
let stepSequence = 0;
const nextStop = (target?: ResolvedAccessibleLocator): ResolvedMaterializationStep =>
  ({ id: `urn:step:${stepSequence++}`, kind: "move", moveKind: { id: "operability:nextStop", type: "focus" }, ...(target ? { locator: target } : {}) });
const pointAt = (target: ResolvedAccessibleLocator): ResolvedMaterializationStep =>
  ({ id: `urn:step:${stepSequence++}`, kind: "move", moveKind: { id: "operability:pointAt", type: "move" }, locator: target });
const activate = (target?: ResolvedAccessibleLocator): ResolvedMaterializationStep => ({ id: `urn:step:${stepSequence++}`, kind: "activation", ...(target ? { locator: target } : {}) });
const transition = (name: string, sequence: number, from: string, to: string, target: ResolvedAccessibleLocator, steps: ResolvedMaterializationStep[], modality = keyboard) => {
  const path: ResolvedTransitionMaterialization = { id: `urn:materialization:${name}`, transitionId: `urn:transition:${name}`, modality: { id: modality }, steps };
  return {
    ...state(name, sequence, target), id: name, kind: "transition", transition: { id: `urn:transition:${name}`, label: name, from: `urn:state:${from}`, to: `urn:state:${to}` },
    from: { id: `urn:state:${from}`, type: "State" }, to: { id: `urn:state:${to}`, type: "State" }, effects: [],
    activation: { transitionId: `urn:transition:${name}`, eventId: "urn:observation-event:select", from: { id: `urn:state:${from}`, type: "State" }, to: { id: `urn:state:${to}`, type: "State" },
      surfaceId: `urn:surface:${name}`, requiredInputModalityProfiles: profiles, bindings: [binding(name, target, profiles)] },
    materializations: [path]
  };
};

function memoryStore(): JourneyArtifactStore & { contents: Map<string, string | Uint8Array> } {
  const files: JourneyArtifact[] = [];
  const contents = new Map<string, string | Uint8Array>();
  return {
    contents, get files() { return files; },
    async write({ name, data, contentType, scope, format }) {
      const artifact = { name, href: `tests/t/files/${name}`, contentType, ...(scope ? { scope } : {}), ...(format ? { format } : {}) };
      files.push(artifact); contents.set(artifact.href, data); return artifact;
    },
    async read({ href }) { const value = contents.get(href); return typeof value === "string" ? new TextEncoder().encode(value) : value!; }
  };
}

type Operation = ReturnType<typeof state> | ReturnType<typeof transition>;

/** Reports failures to the observer the way the Playwright executor does (its own tests check when). */
function driver(page: Page, operations: Operation[]) {
  const artifacts = memoryStore();
  const observer = findingsObserver({ id: "findings" }, artifacts);
  const execution = { runId: "run", executionId: "keyboard-01", profile: { id: keyboard }, plan: { id: "plan", operations } };
  let actionSequence = 0;
  const find = (id: string) => operations.find((item) => item.id === id)! as never;
  return {
    artifacts, observer,
    /** The check of a state's target, or of a transition's target before its steps, failed. */
    async fail(id: string, message = "Expected locator count 1; last value: count:0") {
      const operation = find(id) as Operation;
      await observer.observeFailure!({ stage: "operation-failed", execution, operation, page, error: { name: "Error", message }, check: { kind: operation.kind === "state" ? "state" : "target" } } as never);
    },
    /** The start check of transition `id` failed before any step. */
    async failStart(id: string, message: string) {
      await observer.observeFailure!({ stage: "operation-failed", execution, operation: find(id), page, error: { name: "Error", message }, check: { kind: "start", materializationId: `urn:materialization:${id}` } } as never);
    },
    /** The step `stepId` of transition `id` failed after pressing `gesture`. */
    async failStep(id: string, stepId: string, gesture: string, message: string) {
      const error = { name: "Error", message };
      const action: JourneyInputAction = { id: `keyboard-01/action/${actionSequence++}`, runId: "run", executionId: "keyboard-01", profileId: keyboard, operationId: id, modalityId: keyboard, command: "move", stepId, unit: "adapter-command", status: "failed", gesture, error };
      observer.onAction!(action);
      const check = { kind: "step", materializationId: `urn:materialization:${id}`, stepId };
      await observer.observeFailure!({ stage: "operation-failed", execution, operation: find(id), page, error, action, check } as never);
    },
    /** The state `id` passed its check. */
    async confirm(id: string) {
      await observer.observeOperation!({ stage: "state-asserted", execution, operation: find(id), page, locator: {} as never, expectedMatchCount: 1 } as never);
    },
    async evidence(): Promise<FindingsEvidence> {
      return (await observer.output({ runId: "run" } as never)).evidence as FindingsEvidence;
    }
  };
}

const widgetPage = `
  <div role="combobox" aria-label="Search" tabindex="0" aria-expanded="false">Search</div>
  <div role="dialog" aria-label="Add widget">
    <h2>Add widget</h2>
    <div role="combobox" aria-label="Widget type" tabindex="0" aria-expanded="true">Table or view</div>
    <div role="listbox" aria-label="Options">
      <div role="option" aria-selected="false" style="display: flex"><span>Table o</span><span>r view</span></div>
      <div role="option" aria-selected="false">Text</div>
    </div>
    <div role="combobox" aria-label="Tables or views" tabindex="0" aria-expanded="false">Pick one</div>
  </div>`;
const addWidget = locator("urn:locator:add-widget", "dialog", "Add widget");
const widgetJourney = () => [
  state("widget-types", 0, locator("urn:locator:options", "listbox", "Options")),
  state("data-widget-form", 1, locator("urn:locator:source", "combobox", "Table or view", [addWidget]))
];

/** Page actions opens a dialog; Save closes it and leaves focus nowhere. */
const dialogPage = `
  <h1 id="title">Home</h1>
  <button id="actions">Page actions</button>
  <div id="slot"></div>
  <script>
    document.getElementById('actions').addEventListener('click', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', 'Edit details');
      dialog.innerHTML = '<label>Title <input id="field"></label> <button id="save">Save</button>';
      document.getElementById('slot').append(dialog);
      dialog.querySelector('#field').focus();
      dialog.querySelector('#save').addEventListener('click', () => {
        dialog.remove();
        document.getElementById('title').textContent = 'Saved';
      });
    });
  </script>`;

const actionsButton = locator("urn:locator:actions", "button", "Page actions");
const titleHeading = locator("urn:locator:saved", "heading", "Saved");

/** Saves the dialog with the keyboard; the model then declares that the user activates Page actions where focus is. */
async function afterSave(reopen: ResolvedMaterializationStep[], start?: ResolvedAccessibleLocator) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  after(() => page.close());
  await page.setContent(dialogPage);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await page.getByRole("dialog", { name: "Edit details" }).waitFor();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await page.getByRole("heading", { name: "Saved" }).waitFor();
  const reopening = transition("reopen", 1, "saved", "dialog", actionsButton, reopen);
  if (start) reopening.materializations = [{ ...reopening.materializations[0]!, startLocator: start }];
  const journey = [state("saved", 0, titleHeading), reopening];
  return { page, drive: driver(page, journey) };
}

test("a failed focus step is a focus finding: where focus is, against the object the step expected", async () => {
  const reopen = [activate(actionsButton)];
  const { drive } = await afterSave(reopen);
  await drive.failStep("reopen", reopen[0]!.id, "Space", "Materialization urn:materialization:reopen step x (ActivationStep): the user must be at urn:locator:actions: focus is at document");
  const [failure, ...rest] = (await drive.evidence()).failures;
  assert.deepEqual(rest, []);
  assert.deepEqual(failure!.expected, { kind: "focus", role: "button", name: "Page actions", expectedCount: 1, count: 1 });
  assert.equal(failure!.snapshot.focus, null, "the dialog closed and the document has focus");
  assert.equal(failure!.snapshot.expectedFocus?.name, "Page actions");
  assert.equal(failure!.snapshot.focusIsExpected, false);
  assert.equal(failure!.target?.name, "Page actions");
  assert.deepEqual(failure!.candidates, [], "a focus check offers no other objects");
  assert.equal(failure!.gesture, "Space");
  assert.match(failure!.snapshot.browser ?? "", /^chromium \d/);
  const png = drive.artifacts.contents.get(failure!.snapshot.screenshot!.href) as Uint8Array;
  assert.deepEqual([...png.subarray(1, 4)], [...Buffer.from("PNG")]);
  assert.equal(failure!.snapshot.path, undefined, "a page that is not http(s) leaves no path");
});

test("a focus move without a locator that did not move is a focus finding too", async () => {
  const reopen = [nextStop(), activate(actionsButton)];
  const { drive } = await afterSave(reopen);
  await drive.failStep("reopen", reopen[0]!.id, "Tab", "focus did not move");
  const [failure] = (await drive.evidence()).failures;
  assert.deepEqual(failure!.expected, { kind: "focus", expectedCount: 1 });
  assert.equal(failure!.target, undefined);
});

test("a failed pointAt step is about the pointer: focus is never compared, and the closest objects are offered", async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  after(() => page.close());
  await page.setContent(widgetPage);
  const missing = locator("urn:locator:source", "combobox", "Table or view", [addWidget]);
  const steps = [pointAt(missing), activate()];
  const journey = [state("widget-types", 0, locator("urn:locator:options", "listbox", "Options")), transition("choose", 1, "widget-types", "form", missing, steps, pointer)];
  const drive = driver(page, journey);
  await drive.failStep("choose", steps[0]!.id, "pointer-move", "(MoveStep operability:pointAt): urn:locator:source must match exactly one object");
  const [failure] = (await drive.evidence()).failures;
  assert.deepEqual(failure!.expected, { kind: "pointer", role: "combobox", name: "Table or view", context: { role: "dialog", name: "Add widget" }, expectedCount: 1, count: 0 });
  assert.equal(failure!.snapshot.expectedFocus, undefined);
  assert.equal(failure!.snapshot.focusIsExpected, undefined);
  assert.deepEqual(failure!.candidates.map((candidate) => candidate.name), ["Tables or views", "Widget type"]);
});

test("a failed state is captured with what was expected and the closest elements inside its context", async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  after(() => page.close());
  await page.setContent(widgetPage);
  const drive = driver(page, widgetJourney());
  await drive.fail("state-data-widget-form");
  const evidence = await drive.evidence();
  assert.equal(evidence.failures.length, 1);
  const [failure] = evidence.failures;
  assert.equal(failure!.operationId, "state-data-widget-form");
  assert.deepEqual(failure!.expected, { kind: "state", role: "combobox", name: "Table or view", context: { role: "dialog", name: "Add widget" }, expectedCount: 1, count: 0 });
  assert.deepEqual(failure!.candidates.map((candidate) => candidate.name), ["Tables or views", "Widget type"], "Search is outside the dialog");
  assert.ok(failure!.candidates.every((candidate) => candidate.box && candidate.role === "combobox"));
  assert.ok(drive.artifacts.contents.has(failure!.snapshot.screenshot!.href));
  assert.deepEqual(drive.artifacts.files.map((file) => file.name), ["findings.failure.keyboard-01.000.png"]);
  assert.match(failure!.error.message, /Expected locator count 1/);
});

test("observing never moves focus or scroll", async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  try {
    await page.setContent(`<main style="height: 3000px">${widgetPage}<input id="field" aria-label="Field" style="position: absolute; top: 2500px"></main>`);
    await page.evaluate("document.getElementById('field').focus({ preventScroll: true }); window.scrollTo(0, 1500)");
    const read = () => page.evaluate("({ scrollY, focused: document.activeElement.id })");
    const before = await read();
    const drive = driver(page, widgetJourney());
    await drive.fail("state-data-widget-form");
    assert.deepEqual(await read(), before);
    const [failure] = (await drive.evidence()).failures;
    assert.equal(failure!.snapshot.focus?.name, "Field");
    assert.equal(failure!.snapshot.focus?.inViewport, false);
  } finally { await page.close(); }
});

test("a failed start check compares focus with where the materialization starts", async () => {
  const { drive } = await afterSave([activate(actionsButton)], actionsButton);
  await drive.failStart("reopen", "Materialization urn:materialization:reopen: the user must start at urn:locator:actions");
  const [failure] = (await drive.evidence()).failures;
  assert.deepEqual(failure!.expected, { kind: "focus", start: true, role: "button", name: "Page actions", expectedCount: 1, count: 1 });
  assert.equal(failure!.stepId, undefined);
  assert.equal(failure!.snapshot.focusIsExpected, false);
});

test("the last confirmed state is the observer's own screenshot, written once beside the failures after it", async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  after(() => page.close());
  await page.setContent(widgetPage);
  const drive = driver(page, widgetJourney());
  await drive.confirm("state-widget-types");
  assert.equal(drive.artifacts.files.length, 0, "nothing is written while nothing fails");
  await drive.fail("state-data-widget-form");
  await drive.fail("state-data-widget-form");
  const [first, second] = (await drive.evidence()).failures;
  assert.equal(first!.before?.operationId, "state-widget-types");
  assert.deepEqual(first!.before, second!.before);
  assert.deepEqual(first!.before!.screenshot.viewport, { width: 800, height: 600 });
  assert.deepEqual(drive.artifacts.files.map((file) => [file.name, file.scope?.operationId]), [
    ["findings.failure.keyboard-01.000.png", "state-data-widget-form"],
    ["findings.state.keyboard-01.001.png", "state-widget-types"],
    ["findings.failure.keyboard-01.002.png", "state-data-widget-form"]
  ]);
});
