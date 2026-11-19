import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { buildReport } from "@openuji/journey-reporter";
import { savedTest, suiteRun, writeRun } from "../../../packages/journey-reporter/test/fixtures.js";
import { serveSite } from "./site-fixture.js";

test("the viewer renders a test's journey path with recorded failures and screenshot previews", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-path-view-"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8R8AAAAASUVORK5CYII=", "base64");
  const run = await writeRun(join(directory, "run"), suiteRun([savedTest()]), () => png);
  await buildReport(run);
  const server = await serveSite(run, join(directory, "site"));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 800 } });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.origin}index.html#test=manual-plan`);
    await page.locator('[data-node-id="first-occurrence"]').waitFor();
    assert.equal(await page.locator("[data-node-id]").count(), 2);
    assert.equal(await page.locator('[data-node-id="first-occurrence"]').getAttribute("data-outcome"), "passed");
    assert.equal(await page.locator('[data-node-id="second-occurrence"]').getAttribute("data-outcome"), "failed");
    await page.locator('[tabindex="0"][data-open]').first().focus();
    const preview = page.locator('[data-open="true"] img');
    await preview.waitFor({ state: "visible" });
    // Evidence hrefs are relative to the run directory.
    assert.equal(await preview.getAttribute("src"), "./tests/manual-plan/files/right.png");
    await preview.evaluate((image) => (image as HTMLImageElement).decode());
    await page.locator('[tabindex="0"][data-open]').first().blur();
    assert.equal(await page.locator('[data-open="true"] img').count(), 0);
    await page.setViewportSize({ width: 350, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
