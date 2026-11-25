import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { canonicalMaterializationExtension, type ResolvedAccessibleLocator, type ResolvedTransitionMaterialization, type TransitionPlanOperation } from "@openuji/journey-execution-model";
import type { DiscoveredMaterializationStep, DiscoveryFinding } from "@openuji/journey-plugin";
import { runJourney, type JourneyPlan } from "@openuji/journey-runner";
import { PlaywrightPathFinder, PlaywrightStepPerformer, defaultPlaywrightKeyboard, playwrightExecutor, playwrightDiscoveryExecutor, toPlaywrightLocator } from "../src/index.js";

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const keyboard = "observability:keyboard";

const locator = (id: string, role: string, accessibleName: string): ResolvedAccessibleLocator =>
  ({ id, role, accessibleName, features: [{ id: `${id}:exact`, name: "accessible-name-exact", value: "true" }], contexts: [] });
const button = (name: string) => locator(`urn:locator:${name}`, "button", name);
const tab = (name: string) => locator(`urn:locator:${name}-tab`, "tab", name);

const buttonsPage = `${["B1", "B2", "B3", "B4", "B5", "B6"].map((name) => `<button onclick="document.title = '${name} pressed'">${name}</button>`).join("")}
  <button tabindex="-1">Unreachable</button><input aria-label="Name" autofocus>`;

/** A WAI-ARIA tab list with roving tabindex; arrow keys wrap around. */
const tabsPage = `<button>Before</button>
  <div role="tablist" aria-label="Pages">
    <button role="tab" aria-selected="true" tabindex="0">Home</button>
    <button role="tab" aria-selected="false" tabindex="-1">Drafts</button>
    <button role="tab" aria-selected="false" tabindex="-1">Backlog</button>
  </div>
  <button>After</button>
  <h2 id="shown">Home</h2>
  <script>
    const tabs = [...document.querySelectorAll('[role=tab]')];
    for (const tab of tabs) tab.addEventListener('click', () => {
      for (const other of tabs) { other.setAttribute('aria-selected', String(other === tab)); other.tabIndex = other === tab ? 0 : -1; }
      document.getElementById('shown').textContent = tab.textContent;
    });
    document.querySelector('[role=tablist]').addEventListener('keydown', (event) => {
      const index = tabs.indexOf(document.activeElement);
      const next = { ArrowRight: tabs[(index + 1) % tabs.length], ArrowLeft: tabs[(index + tabs.length - 1) % tabs.length] }[event.key];
      if (!next) return;
      event.preventDefault();
      for (const other of tabs) other.tabIndex = other === next ? 0 : -1;
      next.focus();
    });
  </script>`;

const options = (page: Page) => ({
  page, keyboard: defaultPlaywrightKeyboard, pointer: {}, timeoutMs: 1_000,
  record: async (_command: unknown, work: (gesture: (value: string) => void) => Promise<void>) => work(() => {})
});
const finder = (page: Page, maxStops?: number) => new PlaywrightPathFinder(options(page), { settleMs: 10, ...(maxStops ? { maxStops } : {}) });

/** The proposal as the model would declare it, for the strict performer to replay. */
const replay = (moves: readonly string[], target: ResolvedAccessibleLocator): ResolvedTransitionMaterialization => ({
  id: "urn:material", transitionId: "urn:transition", modality: { id: keyboard },
  steps: [
    ...moves.map((kind, index) => ({ id: `urn:step:${index}`, kind: "move" as const, moveKind: { id: kind, type: "focus" as const }, ...(index === moves.length - 1 ? { locator: target } : {}) })),
    { id: "urn:step:activate", kind: "activation" as const, ...(moves.length ? {} : { locator: target }) }
  ]
});

async function page(html: string, run: (page: Page) => Promise<void>): Promise<void> {
  const created = await browser.newPage();
  try { await created.setContent(html); await run(created); }
  finally { await created.close(); }
}

test("discovery takes the shorter direction and the strict performer replays the path from the same start", async () => {
  await page(buttonsPage, async (current) => {
    await current.getByRole("button", { name: "B4" }).focus();
    const path = await finder(current).findPath(await toPlaywrightLocator(current, button("B2")), false);
    assert.equal(path.found, true, path.found ? undefined : path.note);
    assert.deepEqual(path.found && path.moves, ["operability:previousStop", "operability:previousStop"]);
    assert.equal(await current.evaluate(() => document.activeElement?.textContent), "B2");

    await current.getByRole("button", { name: "B4" }).focus();
    await new PlaywrightStepPerformer(options(current)).perform(replay(path.found ? path.moves : [], button("B2")));
    assert.equal(await current.title(), "B2 pressed");
  });
});

test("an item of a tab list is reached by walking into the list, then with the shorter arrow direction", async () => {
  await page(tabsPage, async (current) => {
    await current.getByRole("button", { name: "Before" }).focus();
    const path = await finder(current).findPath(await toPlaywrightLocator(current, tab("Backlog")), false);
    assert.deepEqual(path.found && path.moves, ["operability:nextStop", "operability:previousItem"]);

    // The walk moved the roving tab stop; a run starts from a freshly loaded page.
    await current.goto("about:blank");
    await current.setContent(tabsPage);
    await current.getByRole("button", { name: "Before" }).focus();
    await new PlaywrightStepPerformer(options(current)).perform(replay(path.found ? path.moves : [], tab("Backlog")));
    assert.equal(await current.locator("#shown").textContent(), "Backlog");
  });
});

test("a text field that already has focus needs no moves", async () => {
  await page(buttonsPage, async (current) => {
    const path = await finder(current).findPath(await toPlaywrightLocator(current, locator("urn:locator:name", "textbox", "Name")), true);
    assert.deepEqual(path.found && path.moves, []);
  });
});

test("an object outside the tab order is reported as not found, with the objects the walk passed", async () => {
  await page(buttonsPage, async (current) => {
    await current.getByRole("button", { name: "B1" }).focus();
    const path = await finder(current, 8).findPath(await toPlaywrightLocator(current, button("Unreachable")), false);
    assert.equal(path.found, false);
    assert.match(path.found ? "" : path.note, /8 operability:nextStop moves did not reach it/);
    assert.ok(path.passed.length > 0);
  });
});

test("a walk is measured only once the application has stopped moving focus", async () => {
  await page(`<button onclick="openDialog()">Open</button><div id="dialog" hidden><button>Close</button><input aria-label="Title"></div>
    <script>function openDialog() { document.getElementById('dialog').hidden = false; setTimeout(() => document.querySelector('input').focus(), 250); }</script>`, async (current) => {
    await current.getByRole("button", { name: "Open" }).focus();
    await current.keyboard.press("Enter");
    const path = await finder(current).findPath(await toPlaywrightLocator(current, locator("urn:locator:title", "textbox", "Title")), true);
    assert.deepEqual(path.found && path.moves, [], "the dialog focuses its field itself");
  });
});

const mainPage = `<button onclick="document.title = 'N1 pressed'">N1</button><main tabindex="-1">${["M1", "M2", "M3", "M4", "M5", "M6"].map((name) => `<button onclick="document.title = '${name} pressed'">${name}</button>`).join("")}</main><button>After</button>`;

test("from a start outside the tab order, the backward walk is counted around the cycle and replays", async () => {
  await page(mainPage, async (current) => {
    await current.locator("main").focus();
    const path = await finder(current).findPath(await toPlaywrightLocator(current, button("M6")), false);
    assert.equal(path.found, true, path.found ? undefined : path.note);
    const moves = path.found ? path.moves : [];
    assert.ok(moves.length < 6 && moves.every((kind) => kind === "operability:previousStop"), JSON.stringify(path));
    assert.match(path.found ? path.note ?? "" : "", /counted around the cycle/);

    await current.goto("about:blank");
    await current.setContent(mainPage);
    await current.locator("main").focus();
    await new PlaywrightStepPerformer(options(current)).perform(replay(moves, button("M6")));
    assert.equal(await current.title(), "M6 pressed");
  });
});

const plainPage = ["B1", "B2", "B3", "B4", "B5", "B6"].map((name) => `<button onclick="document.title = '${name} pressed'">${name}</button>`).join("");

test("from the document, the shorter backward walk is found and replays", async () => {
  await page(plainPage, async (current) => {
    const path = await finder(current).findPath(await toPlaywrightLocator(current, button("B5")), false);
    assert.deepEqual(path.found && path.moves, ["operability:previousStop", "operability:previousStop"], JSON.stringify(path));

    await current.goto("about:blank");
    await current.setContent(plainPage);
    await new PlaywrightStepPerformer(options(current)).perform(replay(path.found ? path.moves : [], button("B5")));
    assert.equal(await current.title(), "B5 pressed");
  });
});

test("in discovery mode the executor reaches an undeclared transition, takes it, and reports the path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "playwright-discovery-"));
  after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "tabs.html");
  await writeFile(file, tabsPage);
  const client = Object.freeze({ name: "client", resolveEntry: () => Object.freeze({ kind: "url" as const, url: pathToFileURL(file).href }), resolveTransitionValue: () => undefined });
  const heading = (name: string) => [{ id: `urn:obs:${name}`, surfaceId: `urn:surface:${name}`, eventId: "urn:observation-event:presence", requiredInputModalityProfiles: [], locators: [locator(`urn:locator:heading-${name}`, "heading", name)] }];
  const state = (name: string, sequence: number) => ({
    id: `state-${name}`, sequence, kind: "state", actorId: "actor", touchpointId: "touchpoint",
    entry: { id: "entry", stateId: "state-home" }, entryBinding: { id: "entry-binding", value: "tabs" },
    state: { id: `urn:state:${name}` }, surface: { id: `urn:surface:${name}` },
    target: { expectedMatchCount: 1, bindings: heading(name), observation: { stateId: `urn:state:${name}`, surfaceId: `urn:surface:${name}`, expectedMatchCount: 1, bindings: heading(name) } }
  });
  const profiles = [{ id: keyboard, modalities: [{ id: keyboard }] }];
  const transition = {
    ...state("Home", 1), id: "select-drafts", kind: "transition", transition: { id: "urn:transition:select-drafts", label: "Select Drafts", from: "urn:state:Home", to: "urn:state:Drafts" },
    from: { id: "urn:state:Home", type: "State" }, to: { id: "urn:state:Drafts", type: "State" }, effects: [], surface: { id: "urn:surface:select-drafts" },
    activation: { transitionId: "urn:transition:select-drafts", eventId: "urn:observation-event:select", from: { id: "urn:state:Home", type: "State" }, to: { id: "urn:state:Drafts", type: "State" }, surfaceId: "urn:surface:select-drafts", requiredInputModalityProfiles: profiles,
      bindings: [{ id: "urn:obs:select-drafts", surfaceId: "urn:surface:select-drafts", eventId: "urn:observation-event:select", requiredInputModalityProfiles: profiles, locators: [tab("Drafts")] }] }
  } as unknown as TransitionPlanOperation;
  const plan = { id: "tabs", operations: [state("Home", 0), transition, state("Drafts", 2)] } as unknown as JourneyPlan;
  const found: DiscoveryFinding[] = [];
  const result = await runJourney({
    plan,
    profiles: [{ id: "keyboard-only", selectInputModality: () => ({ profileId: "keyboard-only", inputModalityProfile: profiles[0]!, modality: { id: keyboard } }) }],
    executor: playwrightDiscoveryExecutor({ client, browser, assertionTimeoutMs: 2_000 }, { settleMs: 10, record(entry) { found.push(entry); } })
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(found.length, 1);
  assert.equal(found[0].status, "found");
  assert.equal(found[0].transitionId, "urn:transition:select-drafts");
  assert.equal(found[0].profileId, "keyboard-only");
  const steps: DiscoveredMaterializationStep[] = [
    { kind: "move", moveKindId: "operability:nextStop" }, { kind: "move", moveKindId: "operability:nextStop" },
    { kind: "move", moveKindId: "operability:nextItem", locatorId: "urn:locator:Drafts-tab" }, { kind: "activation" }
  ];
  assert.deepEqual(found[0].steps, steps);

  const strict = await runJourney({
    plan,
    profiles: [{ id: "keyboard-only", selectInputModality: () => ({ profileId: "keyboard-only", inputModalityProfile: profiles[0]!, modality: { id: keyboard } }) }],
    executor: playwrightExecutor({ client, browser, assertionTimeoutMs: 2_000 })
  });
  assert.equal(strict.ok, false, "a test run never discovers a path");

  // Rediscovery measures a declared path again and names the one it replaces.
  const declared: ResolvedTransitionMaterialization = { ...replay(["operability:nextStop"], tab("Home")), id: "urn:material:stale" };
  const again: DiscoveryFinding[] = [];
  const rediscovered = await runJourney({
    plan,
    profiles: [{ id: "keyboard-only", selectInputModality: () => ({ profileId: "keyboard-only", inputModalityProfile: profiles[0]!, modality: { id: keyboard }, materialization: declared }) }],
    executor: playwrightDiscoveryExecutor({ client, browser, assertionTimeoutMs: 2_000 }, { settleMs: 10, rediscover: true, record(entry) { again.push(entry); } })
  });
  assert.equal(rediscovered.ok, true, JSON.stringify(rediscovered.errors));
  assert.equal(again[0].replaces, "urn:material:stale");
  assert.deepEqual(again[0].steps, steps);

  const canonical = (id: string, definition: ResolvedTransitionMaterialization["steps"]): ResolvedTransitionMaterialization =>
    ({ id, transitionId: "urn:transition:select-drafts", modality: { id: keyboard }, steps: definition, extensions: { [canonicalMaterializationExtension]: {} } });
  /** Runs one discovery with a canonical materialization, and its fallback when given. */
  const beside = async (materialization: ResolvedTransitionMaterialization, { fallback, rediscover = false }: { fallback?: ResolvedTransitionMaterialization; rediscover?: boolean } = {}) => {
    const records: DiscoveryFinding[] = [];
    const run = await runJourney({
      plan,
      profiles: [{ id: "keyboard-only", selectInputModality: () => ({ profileId: "keyboard-only", inputModalityProfile: profiles[0]!, modality: { id: keyboard }, materialization, ...(fallback ? { fallback } : {}) }) }],
      executor: playwrightDiscoveryExecutor({ client, browser, assertionTimeoutMs: 1_000 }, { settleMs: 10, rediscover, record(entry) { records.push(entry); } })
    });
    return { run, records };
  };
  // Nothing has focus, so a canonical path that only activates the tab fails before it sends any input.
  const atTab = canonical("urn:material:expected", [{ id: "urn:step:expected", kind: "activation", locator: tab("Drafts") }]);
  const around = await beside(atTab);
  assert.equal(around.run.ok, true, JSON.stringify(around.run.errors));
  assert.deepEqual(around.records.map((record) => [record.status, record.replaces, record.steps]), [["found", undefined, steps]]);

  // A canonical path that moved focus before failing leaves the page changed: nothing is measured from there.
  const moved = canonical("urn:material:moved", [{ id: "urn:step:moved", kind: "move", moveKind: { id: "operability:nextStop", type: "focus" }, locator: tab("Backlog") }]);
  const changed = await beside(moved);
  assert.equal(changed.run.ok, false);
  assert.deepEqual(changed.records.map((record) => record.status), ["not-found"]);
  assert.match(changed.records[0]!.note!, /urn:material:moved failed after it sent input/);

  const stale: ResolvedTransitionMaterialization = { ...replay(["operability:nextStop"], tab("Home")), id: "urn:material:stale" };
  // Rediscovery performs the canonical path as declared and measures the one beside it.
  const measured = await beside(atTab, { fallback: stale, rediscover: true });
  assert.equal(measured.run.ok, false, "the canonical path failed");
  assert.deepEqual(measured.records.map((record) => [record.status, record.replaces, record.steps]), [["found", "urn:material:stale", steps]]);

  // After a canonical path changed the page, the fallback is performed as declared, not measured.
  const kept = await beside(moved, { fallback: stale, rediscover: true });
  assert.deepEqual(kept.records.map((record) => [record.status, record.replaces, record.steps]), [["declared", undefined, undefined]], "the fallback was performed as declared, not measured");

  // A canonical path that works is declared, never replaced, and nothing else is measured.
  const working = canonical("urn:material:working", replay(["operability:nextStop", "operability:nextStop", "operability:nextItem"], tab("Drafts")).steps);
  const passed = await beside(working, { fallback: stale, rediscover: true });
  assert.equal(passed.run.ok, true, JSON.stringify(passed.run.errors));
  assert.deepEqual(passed.records.map((record) => [record.status, record.replaces]), [["declared", undefined]]);
});
