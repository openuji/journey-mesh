import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import type { JourneyInputAction } from "@openuji/journey-core";
import type {
  ResolvedAccessibleLocator,
  ResolvedMaterializationStep,
  ResolvedTransitionMaterialization,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";
import { runJourney, type JourneyPlan } from "@openuji/journey-runner";
import {
  PlaywrightStepPerformer,
  defaultPlaywrightKeyboard,
  parsePlaywrightKeyboard,
  playwrightAdapter,
  toPlaywrightLocator,
  type PlaywrightKeyboard,
  type PlaywrightRecordedCommand
} from "../src/index.js";

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const keyboard = "observability:keyboard";
const pointer = "observability:pointer";
const textEntry = "urn:openuji:input-modality:keyboard-text-entry";

const locator = (id: string, role: string, accessibleName?: string): ResolvedAccessibleLocator =>
  ({ id, role, ...(accessibleName ? { accessibleName } : {}), features: [{ id: `${id}:exact`, name: "accessible-name-exact", value: "true" }], contexts: [] });
const tab = (name: string) => locator(`urn:locator:${name.toLowerCase()}-tab`, "tab", name);

let stepSequence = 0;
const move = (kind: string, target?: ResolvedAccessibleLocator): ResolvedMaterializationStep =>
  ({ id: `urn:step:${stepSequence++}`, kind: "move", moveKind: { id: kind, type: kind === "operability:pointAt" ? "move" : "focus" }, ...(target ? { locator: target } : {}) });
const activate = (target?: ResolvedAccessibleLocator): ResolvedMaterializationStep =>
  ({ id: `urn:step:${stepSequence++}`, kind: "activation", ...(target ? { locator: target } : {}) });
const materialization = (modality: string, steps: ResolvedMaterializationStep[], startLocator?: ResolvedAccessibleLocator): ResolvedTransitionMaterialization =>
  ({ id: `urn:material:${stepSequence++}`, transitionId: "urn:transition", modality: { id: modality }, steps, ...(startLocator ? { startLocator } : {}) });

type Logged = PlaywrightRecordedCommand & { gesture?: string };

async function fixture(html: string, run: (page: Page, perform: (m: ResolvedTransitionMaterialization, keys?: PlaywrightKeyboard) => Promise<Logged[]>) => Promise<void>): Promise<void> {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    const pointerState = {};
    await run(page, async (m, keys = defaultPlaywrightKeyboard) => {
      const log: Logged[] = [];
      await new PlaywrightStepPerformer({
        page, keyboard: keys, pointer: pointerState, timeoutMs: 500,
        record: async (command, work) => { let gesture: string | undefined; await work((value) => { gesture = value; }); log.push({ ...command, ...(gesture ? { gesture } : {}) }); }
      }).perform(m);
      return log;
    });
  } finally { await page.close(); }
}

/** A WAI-ARIA tab list with manual activation; `roving: false` puts every tab in the tab sequence. */
function tabsPage({ roving = true, arrows = true, vertical = false } = {}): string {
  return `<button>Before</button>
  <div role="tablist" aria-label="Pages"${vertical ? ' aria-orientation="vertical"' : ""}>
    <button role="tab" aria-selected="true" tabindex="0">Home</button>
    <button role="tab" aria-selected="false" tabindex="${roving ? -1 : 0}">Drafts</button>
    <button role="tab" aria-selected="false" tabindex="${roving ? -1 : 0}">Backlog</button>
  </div>
  <button>After</button>
  <h2 id="shown">Home</h2>
  <script>
    const tabs = [...document.querySelectorAll('[role=tab]')];
    for (const tab of tabs) tab.addEventListener('click', () => {
      for (const other of tabs) { other.setAttribute('aria-selected', String(other === tab)); if (${roving}) other.tabIndex = other === tab ? 0 : -1; }
      document.getElementById('shown').textContent = tab.textContent;
    });
    if (${arrows}) document.querySelector('[role=tablist]').addEventListener('keydown', (event) => {
      const index = tabs.indexOf(document.activeElement);
      const next = { ${vertical ? "ArrowDown" : "ArrowRight"}: tabs[(index + 1) % tabs.length], ${vertical ? "ArrowUp" : "ArrowLeft"}: tabs[(index + tabs.length - 1) % tabs.length], Home: tabs[0], End: tabs[tabs.length - 1] }[event.key];
      if (!next) return;
      event.preventDefault();
      if (${roving}) for (const other of tabs) other.tabIndex = other === next ? 0 : -1;
      next.focus();
    });
  </script>`;
}

const shown = (page: Page) => page.locator("#shown").textContent();

test("a declared keyboard path reaches the middle tab with focus moves and activates it", async () => {
  await fixture(tabsPage(), async (page, perform) => {
    const log = await perform(materialization(keyboard, [move("operability:nextStop"), move("operability:nextStop", tab("Home")), move("operability:nextItem", tab("Drafts")), activate(tab("Drafts"))]));
    assert.equal(await shown(page), "Drafts");
    assert.deepEqual(log.map((entry) => [entry.command, entry.gesture]), [["move", "Tab"], ["move", "Tab"], ["move", "ArrowRight"], ["activate", "Enter"]]);
    assert.ok(log.every((entry) => entry.stepId && entry.materializationId));
    const last = await perform(materialization(keyboard, [move("operability:lastItem", tab("Backlog")), move("operability:firstItem", tab("Home")), activate()], tab("Drafts")));
    assert.deepEqual(last.map((entry) => entry.gesture), ["End", "Home", "Enter"]);
    assert.equal(await shown(page), "Home");
  });
});

test("a tab list that is several tab stops fails where the declared next stop is expected", async () => {
  await fixture(tabsPage({ roving: false }), async (page, perform) => {
    await assert.rejects(
      perform(materialization(keyboard, [move("operability:nextStop"), move("operability:nextStop", tab("Home")), move("operability:nextStop", locator("urn:locator:after", "button", "After"))])),
      /MoveStep operability:nextStop via Tab from tab "Home"\); last value: focus is at tab "Drafts", expected urn:locator:after/
    );
    assert.equal(await shown(page), "Home");
  });
});

test("a tab list without arrow-key handling fails because focus does not move", async () => {
  await fixture(tabsPage({ arrows: false }), async (_page, perform) => {
    await assert.rejects(
      perform(materialization(keyboard, [move("operability:nextStop"), move("operability:nextStop", tab("Home")), move("operability:nextItem", tab("Drafts")), activate()])),
      /MoveStep operability:nextItem via ArrowRight from tab "Home"\); last value: focus did not move/
    );
  });
});

test("orientation comes from mesh configuration, never from the page", async () => {
  const path = () => materialization(keyboard, [move("operability:nextStop"), move("operability:nextStop", tab("Home")), move("operability:nextItem", tab("Drafts")), activate()]);
  await fixture(tabsPage({ vertical: true }), async (page, perform) => {
    await assert.rejects(perform(path()), /via ArrowRight .*focus did not move/);
  });
  await fixture(tabsPage({ vertical: true }), async (page, perform) => {
    await perform(path(), parsePlaywrightKeyboard({ moves: { "operability:nextItem": { tab: "ArrowDown" } } }));
    assert.equal(await shown(page), "Drafts");
  });
});

test("a role the key table does not list fails instead of guessing a key", async () => {
  const page = `<div role="menu" aria-label="Sort"><div role="menuitemradio" aria-checked="true" tabindex="0">Name</div><div role="menuitemradio" aria-checked="false" tabindex="-1">Date</div></div>`;
  await fixture(page, async (_page, perform) => {
    await assert.rejects(
      perform(materialization(keyboard, [move("operability:nextStop"), move("operability:nextItem")])),
      /no key for moves\["operability:nextItem"\] at menuitemradio "Name"; name its role or "\*" in adapters.<name>.options.keyboard.moves\["operability:nextItem"\]/
    );
  });
});

test("an active descendant is where the user is, while typed keys stay in the combobox", async () => {
  const page = `<label for="who">Recipient</label>
    <input id="who" role="combobox" aria-expanded="true" aria-controls="list" aria-autocomplete="list">
    <ul id="list" role="listbox" aria-label="Suggestions"><li id="o1" role="option">One</li><li id="o2" role="option">Two</li></ul>
    <output id="chosen"></output>
    <script>
      const input = document.getElementById('who'), options = [...document.querySelectorAll('[role=option]')];
      input.addEventListener('keydown', (event) => {
        const index = options.findIndex((option) => option.id === input.getAttribute('aria-activedescendant'));
        if (event.key === 'ArrowDown') { event.preventDefault(); input.setAttribute('aria-activedescendant', options[Math.min(index + 1, options.length - 1)].id); }
        if (event.key === 'Enter' && index >= 0) document.getElementById('chosen').textContent = options[index].textContent;
      });
    </script>`;
  await fixture(page, async (fixturePage, perform) => {
    const option = (name: string) => locator(`urn:locator:${name}`, "option", name);
    const log = await perform(materialization(keyboard, [
      move("operability:nextStop", locator("urn:locator:recipient", "combobox", "Recipient")),
      move("operability:nextItem", option("One")), move("operability:nextItem", option("Two")), activate(option("Two"))
    ]));
    assert.deepEqual(log.map((entry) => entry.gesture), ["Tab", "ArrowDown", "ArrowDown", "Enter"]);
    assert.equal(await fixturePage.locator("#chosen").textContent(), "Two");
    assert.equal(await fixturePage.evaluate(() => document.activeElement?.id), "who");
  });
});

test("a pointer path points at exactly one object and presses there", async () => {
  await fixture(tabsPage(), async (page, perform) => {
    const log = await perform(materialization(pointer, [move("operability:pointAt", tab("Backlog")), activate(tab("Backlog"))]));
    assert.equal(await shown(page), "Backlog");
    assert.deepEqual(log.map((entry) => entry.gesture), ["pointer-move", "pointer-press"]);
  });
  await fixture(`<button onclick="window.clicks = (window.clicks ?? 0) + 1">Open</button><button onclick="window.clicks = (window.clicks ?? 0) + 1">Open</button>`, async (page, perform) => {
    await assert.rejects(
      perform(materialization(pointer, [move("operability:pointAt", locator("urn:locator:open", "button", "Open")), activate()])),
      /urn:locator:open must match exactly one object; last value: 2 objects match; the runner never chooses one/
    );
    assert.equal(await page.evaluate(() => (window as unknown as { clicks?: number }).clicks), undefined);
  });
});

test("an object covered by another fails the pointer check", async () => {
  const page = `<button style="position:absolute;top:10px;left:10px;width:120px;height:40px">Save</button>
    <div style="position:absolute;top:0;left:0;width:300px;height:100px;background:white" aria-label="Overlay"></div>`;
  await fixture(page, async (_page, perform) => {
    await assert.rejects(perform(materialization(pointer, [move("operability:pointAt", locator("urn:locator:save", "button", "Save")), activate()])), /the pointer must be at urn:locator:save; last value: pointer is at div/);
  });
});

const formPage = (titleTabIndex = "0") => `<label>Title <input id="title" tabindex="${titleTabIndex}"></label><label>Slug <input id="slug"></label>`;

test("text entry types only at a field that focus moves reached", async () => {
  const title = locator("urn:locator:title", "textbox", "Title");
  const reach = () => materialization(textEntry, [move("operability:nextStop", title)]);
  const typeInto = async (page: Page, m?: ResolvedTransitionMaterialization) => {
    const log: Logged[] = [];
    const performer = new PlaywrightStepPerformer({
      page, keyboard: defaultPlaywrightKeyboard, pointer: {}, timeoutMs: 500,
      record: async (command, work) => { let gesture: string | undefined; await work((value) => { gesture = value; }); log.push({ ...command, ...(gesture ? { gesture } : {}) }); }
    });
    if (m) await performer.perform(m);
    await performer.typeAtFocus(await toPlaywrightLocator(page, title), "Overview", "Transition urn:transition:title", m?.id);
    return log;
  };
  await fixture(formPage(), async (page) => {
    const log = await typeInto(page, reach());
    assert.equal(await page.inputValue("#title"), "Overview");
    assert.deepEqual(log.map((entry) => [entry.command, entry.gesture]), [["move", "Tab"], ["text-entry", "type"]]);
  });
  await fixture(formPage("-1"), async (page) => {
    await assert.rejects(typeInto(page, reach()), /focus is at input "Slug", expected urn:locator:title/);
    assert.equal(await page.inputValue("#slug"), "");
  });
  await fixture(formPage(), async (page) => {
    await assert.rejects(typeInto(page), /text entry types at the focused object.*declare focus moves that reach the field; last value: focus is at the document/);
  });
});

test("shortcuts come from aria-keyshortcuts or the Playwright extension, at the current focus", async () => {
  const page = `<button aria-keyshortcuts="Alt+D" id="drafts">Drafts</button><button id="search">Search</button><output id="last"></output>
    <script>document.addEventListener('keydown', (event) => {
      if (event.altKey && event.code === 'KeyD') document.getElementById('last').textContent = 'drafts';
      if (event.ctrlKey && event.key === 'k') document.getElementById('last').textContent = 'search';
    });</script>`;
  await fixture(page, async (fixturePage, perform) => {
    const exposed = await perform(materialization(keyboard, [{ id: "urn:step:shortcut-a", kind: "shortcut", locator: locator("urn:locator:drafts", "button", "Drafts") }]));
    assert.equal(await fixturePage.locator("#last").textContent(), "drafts");
    assert.equal(exposed[0]?.gesture, "Alt+D");
    assert.equal(await fixturePage.evaluate(() => document.activeElement === document.body), true, "a shortcut does not reach its object first");
    await perform(materialization(keyboard, [{ id: "urn:step:shortcut-b", kind: "shortcut", extensions: { "urn:openuji:playwright:shortcut": { keys: "Control+k" } } }]));
    assert.equal(await fixturePage.locator("#last").textContent(), "search");
  });
});

test("the declared start object is checked before the first step", async () => {
  await fixture(tabsPage(), async (_page, perform) => {
    await assert.rejects(perform(materialization(keyboard, [move("operability:nextItem"), activate()], tab("Drafts"))), /the user must start at urn:locator:drafts-tab; last value: focus is at the document/);
  });
});

test("the adapter runs a selected materialization end to end and records each step", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playwright-materialization-"));
  after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "tabs.html");
  await writeFile(file, tabsPage());
  const driver = Object.freeze({ name: "driver", resolveEntry: () => Object.freeze({ kind: "url" as const, url: pathToFileURL(file).href }), resolveTransitionValue: () => undefined });
  const heading = (name: string) => [{ id: `urn:obs:${name}`, surfaceId: `urn:surface:${name}`, eventId: "urn:observation-event:presence", requiredInputModalityProfiles: [], locators: [locator(`urn:locator:heading-${name}`, "heading", name[0]!.toUpperCase() + name.slice(1))] }];
  const state = (name: string, sequence: number) => ({
    id: `state-${name}`, sequence, kind: "state", actorId: "actor", touchpointId: "touchpoint",
    entry: { id: "entry", stateId: "state-home" }, entryBinding: { id: "entry-binding", value: "tabs" },
    state: { id: `urn:state:${name}` }, surface: { id: `urn:surface:${name}` },
    target: { expectedMatchCount: 1, bindings: heading(name), observation: { stateId: `urn:state:${name}`, surfaceId: `urn:surface:${name}`, expectedMatchCount: 1, bindings: heading(name) } }
  });
  const keyboardMaterialization = materialization(keyboard, [move("operability:nextStop"), move("operability:nextStop", tab("Home")), move("operability:nextItem", tab("Drafts")), activate(tab("Drafts"))]);
  const pointerMaterialization = materialization(pointer, [move("operability:pointAt", tab("Drafts")), activate()]);
  const profiles = [keyboard, pointer].map((id) => ({ id, modalities: [{ id }] }));
  const transition = {
    ...state("home", 1), id: "select-drafts", kind: "transition", transition: { id: "urn:transition", from: "urn:state:home", to: "urn:state:drafts" },
    from: { id: "urn:state:home", type: "State" }, to: { id: "urn:state:drafts", type: "State" }, effects: [], surface: { id: "urn:surface:select-drafts" },
    activation: { transitionId: "urn:transition", eventId: "urn:observation-event:select", from: { id: "urn:state:home", type: "State" }, to: { id: "urn:state:drafts", type: "State" }, surfaceId: "urn:surface:select-drafts", requiredInputModalityProfiles: profiles,
      bindings: [{ id: "urn:obs:select-drafts", surfaceId: "urn:surface:select-drafts", eventId: "urn:observation-event:select", requiredInputModalityProfiles: profiles, locators: [tab("Drafts")] }] },
    materializations: [keyboardMaterialization, pointerMaterialization]
  } as unknown as TransitionPlanOperation;
  const plan = { id: "tabs", operations: [state("home", 0), transition, state("drafts", 2)] } as unknown as JourneyPlan;
  const actions: JourneyInputAction[] = [];
  const result = await runJourney({
    plan,
    profiles: [keyboardMaterialization, pointerMaterialization].map((m) => ({
      id: m.modality.id,
      selectInputModality: () => ({ profileId: m.modality.id, inputModalityProfile: profiles.find((profile) => profile.id === m.modality.id)!, modality: m.modality, materialization: m })
    })),
    adapter: playwrightAdapter({ driver, browser, assertionTimeoutMs: 2_000, executionObservers: [{ name: "actions", onAction(action) { actions.push(action); } }] })
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const completed = actions.filter((action) => action.status === "completed");
  assert.deepEqual(completed.map((action) => [action.modalityId, action.command, action.gesture]), [
    [keyboard, "move", "Tab"], [keyboard, "move", "Tab"], [keyboard, "move", "ArrowRight"], [keyboard, "activate", "Enter"],
    [pointer, "move", "pointer-move"], [pointer, "activate", "pointer-press"]
  ]);
  assert.deepEqual(completed.map((action) => action.stepId), [...keyboardMaterialization.steps, ...pointerMaterialization.steps].map((step) => step.id));
  assert.ok(completed.every((action) => action.materializationId === (action.modalityId === keyboard ? keyboardMaterialization.id : pointerMaterialization.id)));
});
