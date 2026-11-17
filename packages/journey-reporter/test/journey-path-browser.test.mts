import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import type { SuiteResultBundle } from "@openuji/journey-plugin";
import { writeReport } from "../src/publish.js";
import { savedTest } from "./fixtures.js";

test("the viewer renders a test's journey path with recorded failures and screenshot previews", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-path-view-"));
  const suite: SuiteResultBundle = { kind: "suite", ok: false, generatedAt: "2026-11-17", tests: [savedTest()], errors: [], artifacts: [] };
  await writeReport(directory, suite);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8R8AAAAASUVORK5CYII=", "base64");
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
  const server = createServer(async (request, response) => {
    if (request.url?.endsWith(".png")) { response.setHeader("content-type", "image/png"); response.end(png); return; }
    try {
      const path = resolve(directory, decodeURIComponent(new URL(request.url!, "http://localhost").pathname.slice("/project/".length)));
      if (!path.startsWith(directory + "/")) throw new Error("Invalid path");
      response.setHeader("content-type", types[extname(path)] ?? "application/octet-stream");
      response.end(await readFile(path));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 800 } });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/project/index.html#test=manual-plan`);
    await page.locator('[data-node-id="first-occurrence"]').waitFor();
    assert.equal(await page.locator("[data-node-id]").count(), 2);
    assert.equal(await page.locator('[data-node-id="first-occurrence"]').getAttribute("data-outcome"), "passed");
    assert.equal(await page.locator('[data-node-id="second-occurrence"]').getAttribute("data-outcome"), "failed");
    await page.locator('[tabindex="0"][data-open]').first().focus();
    const preview = page.locator('[data-open="true"] img');
    await preview.waitFor({ state: "visible" });
    // Test artifact hrefs are relative to the test directory below the suite root.
    assert.equal(await preview.getAttribute("src"), "manual-plan/right.png");
    await preview.evaluate((image) => (image as HTMLImageElement).decode());
    await page.locator('[tabindex="0"][data-open]').first().blur();
    assert.equal(await page.locator('[data-open="true"] img').count(), 0);
    await page.setViewportSize({ width: 350, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise<void>((done) => server.close(() => done())); }
});
