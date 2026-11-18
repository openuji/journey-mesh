import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { readJsonDocument, writeHtmlPages } from "@openuji/journey-plugin";
import { fileArtifactStore } from "../src/artifact-store.js";
import { writeReport } from "../src/publish.js";
import { openReport, type TestManifest, type StoredExecution } from "../src/report-data.js";
import { savedTest } from "./fixtures.js";
import { serveDirectory } from "./http-fixture.js";

test("finding fragments follow bounded provider pages over HTTP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "report-pages-browser-"));
  const store = fileArtifactStore(directory, "", 2500);
  await writeHtmlPages(store, { name: "audit.html", header: "<!doctype html><html><body><main>", footer: "</main></body></html>",
    sections: Array.from({ length: 20 }, (_, index) => `<section id="finding-${index}"><h2>Finding ${index}</h2>${"evidence ".repeat(50)}</section>`) });
  const browser = await chromium.launch({ headless: true }); const server = await serveDirectory(directory);
  try {
    const page = await browser.newPage();
    await page.goto(`${server.origin}audit.html#finding-19`);
    await page.locator("#finding-19").waitFor();
    assert.match(page.url(), /audit\.page-\d+\.html#finding-19/);
    assert.ok(server.requests.filter((name) => name.endsWith(".html")).length > 1);
  } finally { await browser.close(); await server.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a missing execution chunk displays an error and can be retried without loading raw evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "report-retry-browser-"));
  const testResult = { ...savedTest(), artifacts: [] };
  await writeReport(directory, { kind: "suite", ok: false, generatedAt: "now", tests: [testResult], errors: [], artifacts: [] });
  const read = ({ href }: { href: string }) => readFile(join(directory, href));
  const handle = await openReport(read);
  const descriptor = JSON.parse(new TextDecoder().decode(await read(handle.tests[0].manifest))) as TestManifest;
  const executions = await readJsonDocument<StoredExecution[]>(read, descriptor.executions);
  const missing = join(directory, executions[0].evidence.href);
  const data = await readFile(missing); await rm(missing);
  const browser = await chromium.launch({ headless: true }); const server = await serveDirectory(directory);
  try {
    const page = await browser.newPage();
    await page.goto(`${server.origin}index.html#test=manual-plan`);
    await page.getByRole("button", { name: "Retry loading test" }).waitFor();
    assert.match(await page.getByRole("status").innerText(), /could not be loaded/);
    await writeFile(missing, data);
    await page.getByRole("button", { name: "Retry loading test" }).click();
    await page.locator('[data-node-id="second-occurrence"][data-outcome="failed"]').waitFor();
    assert.ok(!server.requests.some((name) => /observers\/\d+\/evidence/.test(name)));
  } finally { await browser.close(); await server.close(); await rm(directory, { recursive: true, force: true }); }
});
