import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildReport, compareRuns } from "@openuji/journey-reporter";
import { testRecordFormat, type TestRecord } from "@openuji/journey-run-record";
import { loadUjgDocument, toJourneyMapDocument } from "@openuji/journey-model-ujg";
import { fixtureConfig, suiteRun, writeRun } from "../../../packages/journey-reporter/test/fixtures.js";
import { serveSite } from "./site-fixture.js";

/** The journey map is projected from the real, executed JSON-LD document. */
const journeyMap = toJourneyMapDocument(await loadUjgDocument(fileURLToPath(new URL("../../../examples/nextcloud-filesharing/ujg/comparison/nc34.ujg.jsonld", import.meta.url))));
/** A login journey from its own document, whose steps are all in the setup phase. */
const setupMap = toJourneyMapDocument(await loadUjgDocument(fileURLToPath(new URL("../../../examples/nextcloud-filesharing/ujg/setup.web.ujg.jsonld", import.meta.url))));
const states = ["alice-files-ready", "alice-share-panel-open", "alice-remote-recipient-entered", "alice-share-permissions-open", "alice-share-confirmed"].map((id) => `urn:state:${id}`);
const clean = { violations: 0, incomplete: 0, passes: 10, inapplicable: 4 };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8R8AAAAASUVORK5CYII=", "base64");
const testDir = (id: string) => encodeURIComponent(id).replace(/\./g, "%2E");

/** A recorded test that ran Alice's journey of the real nc34 document; `failAt` fails that state and leaves the rest unexecuted. */
function savedTest(side: string, id: string, index: number, failAt?: number): TestRecord {
  const profiles = ["default", "keyboard"];
  const operations = states.map((state, sequence) => ({ id: `${id}/alice/${state}`, sequence, kind: "state" as const, segment: "alice", actorId: "urn:user:alice", touchpointId: "urn:touchpoint:nextcloud-a", entry: { id: "entry", stateId: states[0] }, state: { id: state }, surface: { id: "surface" }, target: { expectedMatchCount: 1, bindings: [], observation: { stateId: state, surfaceId: "surface", expectedMatchCount: 1, bindings: [] } } }));
  const outcome = (sequence: number) => failAt === undefined || sequence < failAt ? { kind: "passed" as const } : { kind: "failed" as const, error: { name: "Error", message: "Share permissions did not open" } };
  const emptySummary = { violations: 0, incomplete: 0, passes: 0, inapplicable: 0 };
  return {
    format: testRecordFormat, version: 2, ok: failAt === undefined, id, plan: { id: "plan", operations }, observerErrors: [],
    segments: [
      { id: "login", journeyId: "urn:journey:alice-web-setup", executor: "web", view: "setup" },
      { id: "alice", journeyId: "urn:journey:alice-federated-sharing", executor: "web", view: "nc34" }
    ],
    views: { setup: { format: "journey-map", document: setupMap }, nc34: { format: "journey-map", document: journeyMap } },
    result: {
      ok: failAt === undefined, runId: `${side}-${id}`, plan: { id: "plan" }, errors: [],
      assessments: profiles.map((profile) => ({ kind: "applicable", profile: { id: profile } })),
      executions: profiles.map((profile) => ({ executionId: profile, profileId: profile, outcome: failAt === undefined ? { kind: "passed" } : outcome(failAt) })),
      evidence: { executions: profiles.map((profile) => ({ executionId: profile, profileId: profile, operations: operations.slice(0, failAt === undefined ? undefined : failAt + 1).map((operation) => ({ operationId: operation.id, operationKind: "state", outcome: outcome(operation.sequence) })) })) }
    },
    observers: [{
      id: "axe", kind: "fixture-nodes", errors: [],
      measurements: profiles.map((profile, offset) => ({ id: "effort", label: "Observed commands", method: "custom", unit: "command", aggregation: "count", status: "available", value: (side === "baseline" ? 10 : 1) + index + offset, scope: { runId: `${side}-${id}`, executionId: profile, profileId: profile, operationIds: [] } })),
      evidence: {
        nodes: profiles.flatMap((profile) => [
          { executionId: profile, operationId: operations[0].id, metrics: { kind: "axe", pageState: { violations: side === "baseline" ? 3 : 1, incomplete: 2, passes: 30, inapplicable: 32 }, matchedSurface: clean } },
          { executionId: profile, operationId: operations[1].id, metrics: { kind: "skipped" } }
        ]),
        data: [{ name: "axe-path.json", format: "journey-mesh/axe-path", label: "Browser accessibility report (axe)", value: { format: "journey-mesh/axe-path", reportId: `${side} axe path`, createdAt: "now", wcagTags: [], metadata: {},
          summary: { items: 0, audited: 0, skipped: 0, notApplicable: 0, violations: 0, incomplete: 0, passes: 0, inapplicable: 0, scanSummaries: { "page-state": emptySummary, "matched-surface": emptySummary } }, items: [] } }]
      }
    }],
    files: profiles.map((profile) => ({ name: `${profile}.png`, href: `tests/${testDir(id)}/files/${profile}.png`, contentType: "image/png", scope: { runId: `${side}-${id}`, executionId: profile, profileId: profile, operationId: operations[0].id } }))
  };
}

/** A run directory as `journey-mesh test` leaves it: run record, evidence, and the derived report. */
async function savedRun(root: string, side: string): Promise<string> {
  const tests = ["sharing", "another task"].map((id, index) => savedTest(side, id, index, side === "candidate" && id === "sharing" ? 3 : undefined));
  const directory = await writeRun(join(root, `${side}-results`), suiteRun(tests, { label: side === "baseline" ? "Nextcloud 34" : "PR 66147" }), () => png);
  await buildReport(directory, { config: fixtureConfig({ excludedPhaseIds: ["urn:phase:setup"] }) });
  return directory;
}

test("comparison draws both journey maps with node metrics and links each subject to its own report", async () => {
  const root = await mkdtemp(join(tmpdir(), "journey-viewer-"));
  const output = join(root, "comparison");
  await compareRuns({ baseline: await savedRun(root, "baseline"), candidate: await savedRun(root, "candidate"), outputDir: output, title: "Journey comparison" });
  const server = await serveSite(output, join(root, "site"));
  const { origin, requests: requested } = server;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}index.html`);
    const selected = () => page.locator("section[data-comparison-pair]:visible");
    const pane = (side: string) => selected().locator(`article[data-subject=${side}]`);
    const node = (side: string, state: string) => pane(side).locator(`[data-node-id="urn:state:${state}"]`);
    await node("candidate", "alice-files-ready").waitFor();
    // The viewer reads the report model and evidence files only, never the run records.
    assert.ok(requested.includes("report/report.json"));
    assert.ok(!requested.some((name) => name.endsWith("run.json")));
    assert.equal(await pane("baseline").locator("[data-journey-map]").count(), 1);
    assert.equal(await pane("candidate").locator("[data-journey-map]").count(), 1);
    // A document made only of setup steps (the login) is preparation, not the scenario: it is not drawn.
    for (const side of ["baseline", "candidate"]) {
      assert.equal(await pane(side).locator(".journey-document").count(), 1);
      assert.equal(await pane(side).getByText("Alice web login setup").count(), 0);
    }
    // Node footers carry the basic metrics; everything else lives in the linked reports.
    assert.match(await node("baseline", "alice-files-ready").innerText(), /3V\s*·\s*2I[\s\S]*CLEAN/);
    assert.match(await node("candidate", "alice-files-ready").innerText(), /1V\s*·\s*2I/);
    assert.match(await node("baseline", "alice-share-panel-open").innerText(), /SKIPPED/);
    assert.equal(await node("baseline", "alice-share-permissions-open").getAttribute("data-outcome"), "passed");
    assert.equal(await node("candidate", "alice-share-permissions-open").getAttribute("data-outcome"), "failed");
    assert.equal(await node("candidate", "alice-share-confirmed").getAttribute("data-outcome"), "not-executed");
    assert.match(await pane("baseline").locator(".journey-client-control").first().innerText(), /Nextcloud A[\s\S]*Web/);
    assert.equal(await page.locator(".accessibility-metrics-legend").getByText("Browser · axe").count(), 1);
    assert.equal(await pane("baseline").getByRole("link", { name: "Open Nextcloud 34 details" }).getAttribute("href"), "#subject=baseline&test=sharing&profile=default");
    // Interpreter data opens in the viewer's provider view, chosen by its format.
    await pane("candidate").getByRole("link", { name: "Open Browser accessibility report (axe)" }).click();
    await page.getByRole("heading", { name: "candidate axe path axe path report" }).waitFor();
    assert.match(page.url(), /subject=candidate&data=report%2Fdata%2Fsharing%2Faxe%2Faxe-path\.json/);
    await page.goBack();

    await page.getByLabel("Profile", { exact: true }).selectOption({ label: "keyboard" });
    for (const side of ["baseline", "candidate"]) assert.equal(await pane(side).getAttribute("data-profile"), "keyboard");
    await page.getByLabel("Scenario", { exact: true }).selectOption({ label: "another task" });
    assert.equal(await pane("candidate").getAttribute("data-test"), "another task");
    assert.equal(await node("candidate", "alice-share-permissions-open").getAttribute("data-outcome"), "passed");
    const urls = await page.locator("script[src],link[rel=stylesheet]").evaluateAll((elements) => elements.map((element) => element instanceof HTMLLinkElement ? element.href : (element as HTMLScriptElement).src));
    assert.ok(urls.every((url) => new URL(url).pathname.startsWith("/project/")));
    for (const url of urls) assert.equal((await page.request.get(url)).status(), 200);
    await page.screenshot({ path: "/tmp/journey-mesh-report-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: "/tmp/journey-mesh-report-mobile.png", fullPage: true });

    // Each subject opens as its own full report with the same map, profile switch and details.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}index.html#subject=candidate&test=sharing&profile=default`);
    await page.locator('[data-node-id="urn:state:alice-share-permissions-open"][data-outcome=failed]').waitFor();
    const sharing = page.locator('section[data-test="sharing"]');
    await sharing.getByRole("button", { name: "keyboard" }).click();
    await sharing.locator('.profile-switch button[aria-pressed="true"]', { hasText: "keyboard" }).waitFor();
    // Every test stays on the suite page; offscreen maps load when displayed.
    await sharing.locator("[data-journey-map]").waitFor();
    const another = page.locator('section[data-test="another task"]');
    await another.scrollIntoViewIfNeeded();
    await another.locator("[data-journey-map]").waitFor();
    assert.equal(await page.locator("section.test-page [data-journey-map]").count(), 2);
    assert.match(page.url(), /profile=keyboard/);
    assert.equal(await sharing.getByText("Executed steps and outcomes").count(), 1);
    await page.screenshot({ path: "/tmp/journey-mesh-subject-desktop.png", fullPage: true });

    // Root and subject reports both load under the hosting prefix.
    await page.goto(`${origin}index.html`);
    await page.locator('article[data-subject=candidate] [data-node-id="urn:state:alice-share-permissions-open"][data-outcome=failed]').waitFor();
    await page.goto(`${origin}index.html#subject=baseline&test=another%20task&profile=keyboard`);
    await page.locator('section[data-test="another task"] .profile-switch button[aria-pressed="true"]', { hasText: "keyboard" }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
