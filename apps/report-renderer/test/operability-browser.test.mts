import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { operabilityObserver } from "@openuji/journey-observer-operability";
import { buildReport, parseReportConfig } from "@openuji/journey-reporter";
import { testRecordFormat, type TestRecord } from "@openuji/journey-run-record";
import { suiteRun, writeRun } from "../../../packages/journey-reporter/test/fixtures.js";
import { serveSite } from "./site-fixture.js";

const keyboard = { id: "observability:keyboard" };
const touch = { id: "urn:openuji:input:touch", label: "Touch" };
const tab = { id: "urn:locator:drafts-tab", role: "tab", accessibleName: "Drafts", features: [], contexts: [] };
const folder = { id: "urn:locator:ios-files-first-row", role: "text", accessibleName: "Documents", features: [], contexts: [] };
const materialization = {
  id: "urn:materialization:select-drafts:keyboard", label: "Tab to the page bar, then to Drafts", transitionId: "urn:transition:select-drafts", modality: keyboard,
  steps: [
    { id: "urn:step:1", kind: "move" as const, moveKind: { id: "operability:nextStop", type: "focus" as const } },
    { id: "urn:step:2", kind: "move" as const, moveKind: { id: "operability:nextItem", type: "focus" as const }, locator: tab },
    { id: "urn:step:3", kind: "activation" as const }
  ]
};
const touchMaterialization = {
  id: "urn:materialization:bob-refreshes-files:touch", label: "Swipe down on the Files list to refresh", transitionId: "urn:transition:bob-refreshes-files", modality: touch,
  steps: [
    { id: "urn:step:touch:1", kind: "move" as const, moveKind: { id: "urn:openuji:move:swipe-down", type: "move" as const }, locator: folder }
  ]
};
const base = { actorId: "urn:user:owner", touchpointId: "urn:touchpoint:web", entry: { id: "entry", stateId: "urn:state:home" }, segment: "pages" };
const operation = {
  ...base, id: "select-drafts", sequence: 0, kind: "transition" as const,
  transition: { id: "urn:transition:select-drafts", label: "Owner selects Drafts", from: "urn:state:home", to: "urn:state:drafts" },
  from: { id: "urn:state:home", type: "State" as const }, to: { id: "urn:state:drafts", type: "State" as const }, surface: { id: "surface" }, effects: [],
  activation: { transitionId: "urn:transition:select-drafts", eventId: "select", from: { id: "urn:state:home", type: "State" as const }, to: { id: "urn:state:drafts", type: "State" as const }, surfaceId: "surface", requiredInputModalityProfiles: [], bindings: [] },
  materializations: [materialization]
};
const refreshOperation = {
  ...base, id: "bob-refreshes-files", sequence: 1, kind: "transition" as const,
  transition: { id: "urn:transition:bob-refreshes-files", label: "Bob pulls down to refresh Files", from: "urn:state:files", to: "urn:state:shared" },
  from: { id: "urn:state:files", type: "State" as const }, to: { id: "urn:state:shared", type: "State" as const }, surface: { id: "refresh-surface" }, effects: [],
  activation: { transitionId: "urn:transition:bob-refreshes-files", eventId: "touch", from: { id: "urn:state:files", type: "State" as const }, to: { id: "urn:state:shared", type: "State" as const }, surfaceId: "refresh-surface", requiredInputModalityProfiles: [], bindings: [] },
  materializations: [touchMaterialization]
};

/** A recorded keyboard-only run whose arrow key did not move focus, plus a touch swipe-down transition. */
function recordedTest(): TestRecord {
  const execution = { runId: "run", executionId: "keyboard-only", profile: { id: "keyboard-only" }, executor: { name: "playwright" } };
  const observer = operabilityObserver({ id: "input-steps" });
  observer.observeOperation!({ stage: "transition-ready", execution, operation, decision: { profileId: "keyboard-only", inputModalityProfile: { id: "urn:input-profile:keyboard", modalities: [keyboard] }, modality: keyboard, materialization } } as never);
  observer.observeOperation!({ stage: "transition-ready", execution, operation: refreshOperation, decision: { profileId: "keyboard-only", inputModalityProfile: { id: "urn:input-modality-profile:touch", modalities: [touch] }, modality: touch, materialization: touchMaterialization } } as never);
  const action = (id: string, stepId: string, status: "completed" | "failed", gesture: string, error?: string) =>
    observer.onAction!({ id, runId: "run", executionId: "keyboard-only", profileId: "keyboard-only", operationId: "select-drafts", modalityId: keyboard.id, command: "move",
      materializationId: materialization.id, stepId, gesture, unit: "adapter-command", status, ...(error ? { error: { name: "Error", message: error } } : {}) });
  action("a/0", "urn:step:1", "completed", "Tab");
  action("a/1", "urn:step:2", "failed", "ArrowRight", "focus did not move");
  observer.onAction!({ id: "a/2", runId: "run", executionId: "keyboard-only", profileId: "keyboard-only", operationId: "bob-refreshes-files", modalityId: touch.id, command: "move",
    materializationId: touchMaterialization.id, stepId: "urn:step:touch:1", gesture: "swipe-down", unit: "adapter-command", status: "completed" });
  const failure = { name: "Error", message: "Materialization step urn:step:2 (MoveStep operability:nextItem via ArrowRight); last value: focus did not move" };
  const result = {
    ok: false, runId: "run", plan: { id: "plan" }, errors: [failure], assessments: [{ kind: "applicable" as const, profile: { id: "keyboard-only" } }],
    executions: [{ executionId: "keyboard-only", profileId: "keyboard-only", outcome: { kind: "failed" as const, error: failure } }],
    evidence: { executions: [{ executionId: "keyboard-only", profileId: "keyboard-only", operations: [
      { operationId: "select-drafts", operationKind: "transition" as const, outcome: { kind: "failed" as const, error: failure } },
      { operationId: "bob-refreshes-files", operationKind: "transition" as const, outcome: { kind: "passed" as const } }
    ] }] }
  };
  return {
    format: testRecordFormat, version: 2, id: "pages", ok: false, segments: [], views: {}, plan: { id: "plan", operations: [operation, refreshOperation] },
    result, observers: [observer.output(result as never)], observerErrors: [], files: []
  };
}

test("the Input steps page shows each declared step with its key and where it failed", async () => {
  const root = await mkdtemp(join(tmpdir(), "operability-report-"));
  const directory = await writeRun(join(root, "results"), suiteRun([recordedTest()]));
  await buildReport(directory, { config: parseReportConfig({ report: { interpreters: [{ use: "@openuji/journey-report-operability" }] } }) });
  const server = await serveSite(directory, join(root, "site"));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.origin}index.html#test=pages`);
    await page.getByRole("link", { name: "Open Input steps" }).click();
    await page.getByRole("heading", { name: "Input steps", level: 1 }).waitFor();
    const transition = page.locator("article.input-transition", { has: page.getByRole("heading", { name: /Owner selects Drafts/ }) });
    assert.match(await transition.innerText(), /Through observability:keyboard, declared steps Tab to the page bar, then to Drafts/);
    const rows = transition.locator("tbody tr");
    assert.deepEqual(await rows.evaluateAll((elements) => elements.map((row) => row.getAttribute("data-status"))), ["completed", "failed", "not-performed"]);
    assert.match(await rows.nth(0).innerText(), /Move · next stop[\s\S]*Tab[\s\S]*Done/);
    assert.match(await rows.nth(1).innerText(), /Move · next item[\s\S]*tab “Drafts”[\s\S]*ArrowRight[\s\S]*Failed[\s\S]*focus did not move/);
    assert.match(await rows.nth(2).innerText(), /Activate[\s\S]*Not performed/);
    const refresh = page.locator("article.input-transition", { has: page.getByRole("heading", { name: /Bob pulls down to refresh Files/ }) });
    assert.match(await refresh.innerText(), /Through Touch, declared steps Swipe down on the Files list to refresh/);
    assert.match(await refresh.locator("tbody tr").nth(0).innerText(), /Move · swipe down[\s\S]*text “Documents”[\s\S]*Touch swipe down[\s\S]*Done/);
    assert.equal(await refresh.locator("kbd").count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
