import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { buildReport } from "@openuji/journey-reporter";
import { fixtureConfig, savedTest, suiteRun, writeRun } from "../../../packages/journey-reporter/test/fixtures.js";
import { serveSite } from "./site-fixture.js";

test("data split into chunks by a size-limited site loads in the data view, and a missing test model can be retried", async () => {
  const directory = await mkdtemp(join(tmpdir(), "report-site-browser-"));
  const record = { ...savedTest(), observers: [{ id: "nodes", kind: "fixture-nodes", measurements: [], errors: [], evidence: { nodes: [], data: [
    { name: "large.json", format: "fixture/large", label: "Large fixture data", value: Array.from({ length: 30000 }, (_, index) => ({ index, text: "x".repeat(40) })) }
  ] } }] };
  const run = await writeRun(join(directory, "run"), suiteRun([record]));
  await buildReport(run, { config: fixtureConfig() });
  const site = join(directory, "site");
  const server = await serveSite(run, site, 1024 * 1024);
  const browser = await chromium.launch({ headless: true });
  try {
    assert.equal(JSON.parse(await readFile(join(site, "report/data/manual-plan/nodes/large.json"), "utf8")).format, "journey-mesh/json-document");
    const page = await browser.newPage();
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.origin}index.html#test=manual-plan`);
    await page.getByRole("link", { name: "Open Large fixture data" }).click();
    await page.locator('[data-format="fixture/large"] pre').waitFor();
    assert.match(await page.locator('[data-format="fixture/large"] pre').innerText(), /"index": 29999/);
    // A missing test model shows an error and can be retried.
    const model = join(site, "report/tests/manual-plan.json");
    await rename(model, `${model}.hidden`);
    await page.goto(`${server.origin}index.html#test=manual-plan`);
    await page.reload();
    await page.getByRole("button", { name: "Retry loading test" }).waitFor();
    assert.match(await page.getByRole("status").innerText(), /could not be loaded/);
    await rename(`${model}.hidden`, model);
    await page.getByRole("button", { name: "Retry loading test" }).click();
    await page.locator('[data-node-id="second-occurrence"][data-outcome="failed"]').waitFor();
    assert.ok(!server.requests.some((name) => name.endsWith("run.json")));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); await rm(directory, { recursive: true, force: true }); }
});
