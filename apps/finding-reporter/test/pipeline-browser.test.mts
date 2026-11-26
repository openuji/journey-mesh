/**
 * The whole way to a bundle: a journey runs in Chromium with the findings observer, the run record is
 * written, the report is built with the findings interpreter, and the bundle is written from it.
 */
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { canonicalMaterializationExtension, type JourneyPlan } from "@openuji/journey-execution-model";
import { playwrightExecutor } from "@openuji/journey-executor-playwright";
import { findingsObserver } from "@openuji/journey-observer-findings";
import { runJourney } from "@openuji/journey-runner";
import { runRecordVersion, testPassed, testRecordFormat } from "@openuji/journey-run-record";
import { fileEvidenceStore, runReader, writeRunRecord } from "@openuji/journey-run-record/node";
import { buildReport, parseReportConfig } from "@openuji/journey-reporter";
import { writeBundles } from "../src/bundle.js";
import { loadFindings } from "../src/load.js";
import { chromiumRenderer } from "../src/render.js";

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const keyboard = "observability:keyboard";
const profiles = [{ id: keyboard, modalities: [{ id: keyboard }] }];
const locator = (id: string, role: string, accessibleName: string) => ({ id, role, accessibleName, features: [{ id: `${id}:exact`, name: "accessible-name-exact", value: "true" }], contexts: [] });
const save = locator("urn:locator:save", "button", "Save");
const binding = (target: unknown) => ({ id: "urn:obs", surfaceId: "urn:surface", eventId: "urn:event", requiredInputModalityProfiles: profiles, locators: [target] });
const state = (name: string, sequence: number, target: unknown) => ({
  id: name, sequence, kind: "state", segment: "pages", actorId: "actor", touchpointId: "app",
  entry: { id: "entry", stateId: "urn:state:home" }, entryBinding: { id: "entry-binding", value: "page" },
  state: { id: `urn:state:${name}`, label: name === "home" ? "The page is shown" : "The details are saved" }, surface: { id: `urn:surface:${name}` },
  target: { expectedMatchCount: 1, bindings: [binding(target)], observation: { stateId: name, surfaceId: name, expectedMatchCount: 1, bindings: [binding(target)] } }
});
const step = (id: string, kind: "move" | "activation", target?: unknown) =>
  ({ id: `urn:step:${id}`, kind, ...(kind === "move" ? { moveKind: { id: "operability:nextStop", type: "focus" } } : {}), ...(target ? { locator: target } : {}) });
// The model expects focus on Save already; the way around it reaches Save with two focus moves.
const expected = { id: "urn:materialization:save:expected", transitionId: "urn:transition:save", modality: { id: keyboard }, steps: [step("expected", "activation", save)], extensions: { [canonicalMaterializationExtension]: {} } };
const around = { id: "urn:materialization:save:keyboard", transitionId: "urn:transition:save", modality: { id: keyboard }, steps: [step("first", "move"), step("second", "move", save), step("activate", "activation", save)] };
const plan = { id: "plan", operations: [
  state("home", 0, locator("urn:locator:home", "heading", "Home")),
  { ...state("home", 1, save), id: "save", kind: "transition", transition: { id: "urn:transition:save", label: "Save the details", from: "urn:state:home", to: "urn:state:saved" },
    from: { id: "urn:state:home", type: "State" }, to: { id: "urn:state:saved", type: "State" }, effects: [],
    activation: { transitionId: "urn:transition:save", eventId: "urn:event", from: {}, to: {}, surfaceId: "urn:surface", requiredInputModalityProfiles: profiles, bindings: [binding(save)] },
    materializations: [expected, around] },
  state("saved", 2, locator("urn:locator:saved", "heading", "Saved"))
] } as unknown as JourneyPlan;

test("a failed check of a run becomes a bundle, with both frames from the findings observer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "finding-pipeline-"));
  await writeFile(join(directory, "page.html"), `<h1 id="title">Home</h1><button>Skip</button><button id="save">Save</button>
    <script>document.getElementById('save').addEventListener('click', () => { document.getElementById('title').textContent = 'Saved'; });</script>`);
  const artifacts = fileEvidenceStore(directory, "tests/details/files");
  const observer = findingsObserver({ id: "findings" }, artifacts);
  const startedAt = new Date().toISOString();
  const result = await runJourney({
    runId: "pipeline", plan,
    profiles: [{ id: "keyboard-only", selectInputModality: () => ({ profileId: "keyboard-only", inputModalityProfile: profiles[0]!, modality: { id: keyboard }, materialization: expected, fallback: around }) as never }],
    executor: playwrightExecutor({
      client: { name: "client", resolveEntry: () => ({ kind: "url" as const, url: pathToFileURL(join(directory, "page.html")).href }), resolveTransitionValue: () => undefined },
      browser, assertionTimeoutMs: 1_000, executionObservers: [observer]
    })
  });
  assert.deepEqual(result.evidence.executions[0]!.operations.map((operation) => operation.outcome.kind), ["passed", "failed", "passed"], "the way around took the transition");
  const verdict = { result, observers: [await observer.output(result)], observerErrors: [] };
  await writeRunRecord(directory, {
    ok: false, startedAt, finishedAt: new Date().toISOString(), errors: [], provenance: {}, files: [],
    tests: [{ format: testRecordFormat, version: runRecordVersion, id: "details", ok: testPassed(verdict), segments: [], views: {}, plan, ...verdict, files: artifacts.files }]
  });
  const configPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const report = await buildReport(directory, { config: parseReportConfig({ report: { interpreters: [{ use: "@openuji/journey-report-findings" }] } }, configPath) });
  assert.deepEqual(report.model.errors, []);

  const read = runReader(directory);
  const renderer = chromiumRenderer();
  const out = join(directory, "bundles");
  try { await writeBundles({ loaded: await loadFindings(read), read, out, renderer }); }
  finally { await renderer.close(); }
  const id = "details--save";
  assert.deepEqual((await readdir(join(out, id))).sort(), ["annotated.png", "before.png", "evidence.json", "failure.png", "issue.md"]);
  const issue = await readFile(join(out, id, "issue.md"), "utf8");
  assert.match(issue, /^## Focus is not on button "Save" in "Save the details"\n/);
  assert.match(issue, /\[Last confirmed: "The page is shown"\]\(before\.png\)/);
  const evidence = JSON.parse(await readFile(join(out, id, "evidence.json"), "utf8"));
  assert.ok(evidence.finding.frames.every((frame: { screenshot: string }) => frame.screenshot.startsWith("tests/details/files/findings.")), "only the findings observer's own screenshots");
});
