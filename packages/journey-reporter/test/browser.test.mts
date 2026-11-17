import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";
import { writeReport } from "../src/publish.js";
import { validatePairings } from "../src/comparison.js";
import type { ComparisonResultBundle, SuiteResultBundle } from "@openuji/journey-plugin";

function suite(side: string): SuiteResultBundle {
  return {
    kind: "suite", ok: true, generatedAt: "2026-11-17", errors: [], artifacts: [],
    tests: ["sharing", "another task"].map((scenario, index) => {
      const id = `${side} ${scenario}`;
      const operation = { id: `${side}/${scenario}/compiled-operation`, sequence: 0, kind: "state" as const, segment: "task", actorId: "actor", touchpointId: "app", entry: { id: "entry", stateId: "state" }, state: { id: "state", label: `${side} arrival` }, surface: { id: "surface" }, target: { expectedMatchCount: 0, bindings: [], observation: { stateId: "state", surfaceId: "surface", expectedMatchCount: 0, bindings: [] } } };
      const profiles = ["default", "keyboard"];
      return { kind: "test", id, plan: { id: "plan", operations: [operation] }, reportingErrors: [],
        result: { ok: true, runId: id, plan: { id: "plan" }, errors: [], assessments: profiles.map((profile) => ({ kind: "applicable", profile: { id: profile } })), executions: profiles.map((profile) => ({ executionId: profile, profileId: profile, outcome: { kind: "passed" } })), evidence: { executions: profiles.map((profile) => ({ executionId: profile, profileId: profile, operations: [{ operationId: operation.id, operationKind: "state", outcome: { kind: "passed" } }] })) } },
        outputs: [{ id: "custom", kind: "custom", evidence: {}, errors: [], measurements: profiles.map((profile, offset) => ({ id: "effort", label: "Observed commands", method: "custom", unit: "command", aggregation: "count", status: "available", value: (side === "baseline" ? 10 : 1) + index + offset, scope: { runId: id, executionId: profile, profileId: profile, operationIds: [operation.id] } })) }],
        artifacts: profiles.map((profile) => ({ name: `${side}-${scenario}-${profile}.png`, href: `${side}-${scenario}-${profile}.png`, contentType: "image/png", scope: { runId: id, executionId: profile, profileId: profile, operationId: operation.id } }))
      };
    })
  };
}

test("paired paths and evidence stay isolated while scenario and profile controls update both subjects", async () => {
  const baseline = suite("baseline"); const candidate = suite("candidate");
  const pairings = ["sharing", "another task"].flatMap((scenario) => ["default", "keyboard"].map((profile) => ({ id: `${scenario}/${profile}`, baseline: { test: `baseline ${scenario}`, profile }, candidate: { test: `candidate ${scenario}`, profile } })));
  const bundle: ComparisonResultBundle = { kind: "comparison", title: "Journey comparison", ok: true, generatedAt: "2026-11-17", subjects: { baseline: { source: "a/bundle.json", bundle: baseline, errors: [] }, candidate: { source: "b/bundle.json", bundle: candidate, errors: [] } }, pairings: validatePairings(pairings, { baseline, candidate }), errors: [], artifacts: [] };
  const directory = await mkdtemp(join(tmpdir(), "journey-viewer-"));
  await writeReport(directory, bundle);
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
  let failBundle = true;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8R8AAAAASUVORK5CYII=", "base64");
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost");
    if (!url.pathname.startsWith("/project/")) { response.writeHead(404); response.end(); return; }
    if (url.pathname.endsWith(".png")) { response.setHeader("content-type", "image/png"); response.end(png); return; }
    const name = decodeURIComponent(url.pathname.slice("/project/".length));
    if (name === "bundle.json" && failBundle) { failBundle = false; response.writeHead(503); response.end(); return; }
    const path = resolve(directory, name);
    if (!path.startsWith(directory + "/")) { response.writeHead(404); response.end(); return; }
    readFile(path).then((data) => { response.setHeader("content-type", types[extname(path)] ?? "application/octet-stream"); response.end(data); }, () => { response.writeHead(404); response.end(); });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/project/index.html`);
    await page.getByRole("button", { name: "Retry loading report" }).click();
    const selected = () => page.locator("section[data-comparison-pair]:visible");
    await selected().waitFor();
    assert.equal(await selected().count(), 1);
    assert.equal(await selected().locator("article[data-subject]").count(), 2);
    assert.equal(await selected().locator("[data-journey-path]").count(), 2);
    assert.equal(await selected().locator("[data-node-id][data-outcome=passed]").count(), 2);
    await page.getByLabel("Profile", { exact: true }).selectOption({ label: "keyboard" });
    for (const side of ["baseline", "candidate"]) {
      const pane = selected().locator(`article[data-subject=${side}]`);
      assert.equal(await pane.getAttribute("data-profile"), "keyboard");
      assert.equal(await pane.locator("[data-journey-path]").getAttribute("data-journey-path"), "keyboard");
      await pane.getByText("Evidence and screenshots", { exact: true }).click();
      assert.equal(await pane.locator(".evidence-gallery img").count(), 1);
      assert.match(await pane.locator(".evidence-gallery img").getAttribute("src") ?? "", new RegExp(`^subjects/${side}/.*keyboard`));
    }
    await page.getByLabel("Scenario", { exact: true }).selectOption({ label: "baseline another task / candidate another task" });
    for (const side of ["baseline", "candidate"]) {
      const pane = selected().locator(`article[data-subject=${side}]`);
      assert.equal(await pane.getAttribute("data-test"), `${side} another task`);
      assert.equal(await pane.getAttribute("data-profile"), "keyboard");
    }
    await page.getByLabel("Scenario", { exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.getByLabel("Profile", { exact: true }).evaluate((element) => element === document.activeElement), true);
    const urls = await page.locator(".evidence-gallery img[src],script[src],link[rel=stylesheet]").evaluateAll((elements) => elements.map((element) => element instanceof HTMLLinkElement ? element.href : (element as HTMLImageElement | HTMLScriptElement).src));
    assert.ok(urls.some((url) => /\/assets\/.*\.js$/.test(url)));
    assert.ok(urls.some((url) => /\/assets\/.*\.css$/.test(url)));
    assert.ok(urls.every((url) => new URL(url).pathname.startsWith("/project/")));
    for (const url of new Set(urls)) assert.equal((await page.request.get(url)).status(), 200);
    await page.screenshot({ path: "/tmp/journey-mesh-report-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: "/tmp/journey-mesh-report-mobile.png", fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise<void>((done) => server.close(() => done())); }
});
