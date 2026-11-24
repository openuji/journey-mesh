import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { chromium, type Browser } from "playwright";
import type { JourneyPlanOperation } from "@openuji/journey-execution-model";
import type { JourneyArtifact, JourneyArtifactStore } from "@openuji/journey-plugin";
import type { RunResult } from "@openuji/journey-runner";
import { uxGeometryFormat, type UXProbe } from "../src/index.js";
import { uxObserver } from "../src/playwright.js";

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const dialog = [{ id: "dialog-binding", surfaceId: "tour", eventId: "presence", requiredInputModalityProfiles: [],
  locators: [{ id: "urn:locator:tour-dialog", role: "dialog", accessibleName: "Tour", features: [{ id: "exact", name: "accessible-name-exact", value: "true" }], contexts: [] }] }];
const step: JourneyPlanOperation = {
  id: "orphaned-step", sequence: 0, kind: "state", actorId: "learner", touchpointId: "campus", entry: { id: "entry", stateId: "orphaned-step" }, segment: "tour",
  state: { id: "orphaned-step" }, surface: { id: "tour" },
  target: { expectedMatchCount: 1, bindings: dialog, observation: { stateId: "orphaned-step", surfaceId: "tour", expectedMatchCount: 1, bindings: dialog } }
} as unknown as JourneyPlanOperation;
const result: RunResult = { ok: true, runId: "run", plan: { id: "plan" }, errors: [], assessments: [], executions: [{ executionId: "pointer-01", profileId: "pointer", outcome: { kind: "passed" } }],
  evidence: { executions: [{ executionId: "pointer-01", profileId: "pointer", operations: [{ operationId: step.id, operationKind: "state", outcome: { kind: "passed" } }] }] } };

function memoryStore(): JourneyArtifactStore & { contents: Map<string, string | Uint8Array> } {
  const files: JourneyArtifact[] = [];
  const contents = new Map<string, string | Uint8Array>();
  return {
    contents, get files() { return files; },
    async write({ name, data, contentType, scope, format }) {
      const artifact = { name, href: `tests/tour/files/${name}`, contentType, ...(scope ? { scope } : {}), ...(format ? { format } : {}) };
      files.push(artifact); contents.set(artifact.href, data); return artifact;
    },
    async read({ href }) { return new TextEncoder().encode(String(contents.get(href))); }
  };
}

/** A long page scrolled to 1800px, with the tour dialog either fixed in the viewport or placed for the top of the page. */
const page = (placement: "fixed" | "page-top" | "absent") => `
  <main style="height: 3000px"><p>Course content</p>
    <button id="next">Next</button>
    ${placement === "absent" ? "" : `<div role="dialog" aria-label="Tour" style="position: ${placement === "fixed" ? "fixed" : "absolute"}; top: 200px; left: 312px; width: 400px; height: 240px">This page has no tour target</div>`}
    <footer style="position: absolute; top: 2900px">Footer</footer>
  </main>`;

async function observe(placement: "fixed" | "page-top" | "absent", expect: UXProbe["expect"]) {
  const tab = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await tab.setContent(page(placement));
  // Focus first without scrolling, then scroll: focusing later would scroll the button back into view.
  await tab.evaluate("document.getElementById('next').focus({ preventScroll: true }); window.scrollTo(0, 1800)");
  assert.deepEqual(await tab.evaluate("({ scrollY, focused: document.activeElement.id })"), { scrollY: 1800, focused: "next" });
  const artifacts = memoryStore();
  const observer = uxObserver({ id: "tour", operations: [step], counters: [], checkpoints: [],
    probes: [{ id: "dialog", label: "Tour dialog", at: step.id, target: step.id, expect, screenshot: true }] }, artifacts);
  const state = () => tab.evaluate("({ scrollY, focused: document.activeElement && document.activeElement.id })");
  const before = await state();
  await observer.observeOperation!({ stage: "state-asserted", execution: { runId: "run", executionId: "pointer-01", profile: { id: "pointer" }, plan: { id: "plan", operations: [step] } },
    operation: step, page: tab, locator: tab.locator("main"), expectedMatchCount: 1 } as never);
  const afterwards = await state();
  await tab.close();
  return { output: observer.output(result), fact: observer.evidence[0]!, artifacts, before, afterwards };
}

test("a dialog placed for the top of the page is visible but outside the viewport of the scrolled page", async () => {
  const { output, fact, artifacts, before, afterwards } = await observe("page-top", ["scrolled", "visible", "inViewport"]);
  assert.equal(fact.visible, true);
  assert.equal(fact.inViewport, false);
  assert.deepEqual(fact.geometry, { matches: 1, rect: { x: 312, y: -1600, width: 400, height: 240 }, viewport: { width: 1024, height: 768 }, scroll: { x: 0, y: 1800 }, stable: true });
  assert.deepEqual(output.errors.map((error) => error.message), ["Probe dialog in execution pointer-01: expected inViewport, but the target (x 312, y -1600, 400×240) is not contained in the 1024×768 viewport"]);
  assert.deepEqual(afterwards, before, "observing neither scrolls nor moves focus");
  assert.deepEqual(artifacts.files.map((file) => [file.name, file.format ?? null, file.scope?.operationId]), [
    ["tour.dialog.pointer-01.ux-geometry.json", uxGeometryFormat, step.id], ["tour.dialog.pointer-01.viewport.png", null, step.id]]);
  const record = JSON.parse(String(artifacts.contents.get(artifacts.files[0]!.href)));
  assert.deepEqual(record.expectations, [{ expectation: "scrolled", met: true }, { expectation: "visible", met: true }, { expectation: "inViewport", met: false }]);
  assert.deepEqual(fact.files, artifacts.files.map((file) => file.href));
});

test("a dialog contained in the viewport meets every expectation", async () => {
  const { output, fact } = await observe("fixed", ["scrolled", "visible", "inViewport"]);
  assert.equal(fact.inViewport, true);
  assert.deepEqual(output.errors, []);
});

test("a missing dialog cannot satisfy a required expectation", async () => {
  const { output, fact } = await observe("absent", ["visible"]);
  assert.equal(fact.geometry?.matches, 0);
  assert.match(output.errors[0]!.message, /expected visible, but the target matched 0 elements, not exactly one/);
});
