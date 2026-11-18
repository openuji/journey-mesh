import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveDirectory } from "./http-fixture.js";
import { chromium } from "playwright";
import { writeReport } from "../src/publish.js";
import { collectivesTest } from "./collectives-fixture.js";

test("Collectives mixed document shows the UJG map, chips, responsive layout and exact saved axe metrics", async () => {
  const saved = await collectivesTest();
  const directory = await mkdtemp(join(tmpdir(), "collectives-report-"));
  const publish = () => writeReport(directory, { kind: "suite", ok: true, generatedAt: "now", tests: [saved], artifacts: [], errors: [] });
  await publish();
  const browser = await chromium.launch({ headless: true });
  const server = await serveDirectory(directory);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    const url = server.origin + "index.html";
    await page.goto(url);
    const map = page.locator("[data-journey-map]");
    const node = (index: number) => map.locator(`[data-node-id="urn:journey:collective-own:sharing:state:${index}"]`);
    await node(0).waitFor();
    assert.equal(await map.locator('[data-node-id^="urn:journey:collective-own:login:"]').count(), 0);
    assert.equal(await page.locator("[data-journey-path]").count(), 0);
    assert.match(await map.locator(".journey-client-control").innerText(), /Nextcloud Collectives[\s\S]*Web/);
    assert.equal(await map.getByText("Alice Journey", { exact: true }).count(), 1);
    assert.match(await node(0).innerText(), /6V\s*·\s*3I[\s\S]*3V\s*·\s*1I/);
    assert.match(await node(1).innerText(), /SKIPPED/);
    assert.match(await node(2).innerText(), /CLEAN/);
    const first = await node(0).boundingBox(), second = await node(1).boundingBox();
    assert.ok(first && second && second.x > first.x && Math.abs(second.y - first.y) < 4);
    await page.getByRole("button", { name: "keyboard-only", exact: true }).click();
    assert.match(await node(0).innerText(), /2V\s*·\s*3I/);
    await page.screenshot({ path: "/tmp/collectives-report-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const first = document.querySelector('[data-node-id="urn:journey:collective-own:sharing:state:0"]')?.getBoundingClientRect();
      const second = document.querySelector('[data-node-id="urn:journey:collective-own:sharing:state:1"]')?.getBoundingClientRect();
      return first && second && second.top > first.top;
    });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    const mobileFirst = await node(0).boundingBox(), mobileSecond = await node(1).boundingBox();
    assert.ok(mobileFirst && mobileSecond && mobileSecond.y > mobileFirst.y);
    await page.screenshot({ path: "/tmp/collectives-report-mobile.png", fullPage: true });

    // Re-publishing an invalid map exposes its failure, preserving the successful execution evidence.
    delete (saved.views.collectives.document as { journeyEntryIndex?: unknown }).journeyEntryIndex;
    await publish();
    await page.goto(url);
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /JourneyEntryIndex/);
    assert.equal(await page.locator("[data-node-id]").count(), 0);
    assert.equal(await page.locator("[data-journey-path]").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});
