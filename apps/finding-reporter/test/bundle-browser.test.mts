import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after, before } from "node:test";
import { chromium, type Browser } from "playwright";
import { runReader } from "@openuji/journey-run-record/node";
import { writeBundles } from "../src/bundle.js";
import { layoutSheet } from "../src/layout.js";
import { loadFindings } from "../src/load.js";
import { chromiumRenderer } from "../src/render.js";
import { focusWithoutScreenshot, runDirectory, targetMissing } from "./fixture.js";

const root = fileURLToPath(new URL("..", import.meta.url));
let browser: Browser;
let images: Record<string, Uint8Array>;
before(async () => {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(`<div role="dialog" aria-label="Add widget" style="position:absolute;left:250px;top:60px;width:300px;height:300px;border:1px solid #888;padding:16px">
    <h2>Add widget</h2><div style="position:absolute;left:50px;top:60px;width:120px;height:32px;background:#eee">Widget type</div>
    <div style="position:absolute;left:50px;top:140px;width:120px;height:32px;background:#eee">Pick one</div></div>`);
  images = { "tests/page-arrange/files/failure.png": await page.screenshot(), "tests/page-arrange/files/state.png": await page.screenshot({ fullPage: true }) };
  await page.close();
});
after(async () => { await browser?.close(); });

const pngSize = (png: Uint8Array) => { const view = Buffer.from(png); return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) }; };

async function bundleInto(out: string, options: { only?: string } = {}) {
  const run = await runDirectory([targetMissing, focusWithoutScreenshot], { images });
  const read = runReader(run);
  const renderer = chromiumRenderer();
  try { return await writeBundles({ loaded: await loadFindings(read), read, out, renderer, ...options }); }
  finally { await renderer.close(); }
}

test("every finding gets a bundle: raw frames, an annotated sheet at the screenshots' scale, the issue and its evidence", async () => {
  const out = join(await mkdtemp(join(tmpdir(), "bundle-")), "findings");
  const result = await bundleInto(out);
  const directory = join(out, targetMissing.id);
  assert.deepEqual(result.bundles, [
    { id: targetMissing.id, issue: join(directory, "issue.md") },
    { id: focusWithoutScreenshot.id, issue: join(out, focusWithoutScreenshot.id, "issue.md") }
  ]);
  assert.deepEqual((await readdir(out)).sort(), ["index.md", targetMissing.id, focusWithoutScreenshot.id].sort());
  assert.deepEqual((await readdir(directory)).sort(), ["annotated.png", "before.png", "evidence.json", "failure.png", "issue.md"]);
  assert.deepEqual(new Uint8Array(await readFile(join(directory, "failure.png"))), new Uint8Array(images["tests/page-arrange/files/failure.png"]!), "raw frames are copied unchanged");
  const sheet = layoutSheet(targetMissing.frames);
  assert.deepEqual(pngSize(await readFile(join(directory, "annotated.png"))), { width: sheet.width * sheet.scale, height: sheet.height * sheet.scale });
  assert.match(await readFile(join(directory, "issue.md"), "utf8"), /^## Combobox "Table or view" not found in the dialog "Add widget"\n/);
  const evidence = JSON.parse(await readFile(join(directory, "evidence.json"), "utf8"));
  assert.equal(evidence.finding.id, targetMissing.id);
  assert.equal(evidence.environment.target.pullRequest, 3215);
  // Without a screenshot there is nothing to draw, but the finding is still reported.
  assert.deepEqual((await readdir(join(out, focusWithoutScreenshot.id))).sort(), ["evidence.json", "issue.md"]);
  const index = await readFile(result.index, "utf8");
  assert.match(index, /\[Combobox "Table or view" not found in the dialog "Add widget"\]\(page-arrange--data-widget-form\/issue\.md\)/);
  assert.match(index, /\[Focus is not on button "Page actions" in "Open Page actions again"\]\(page-manage--open-page-actions-again\/issue\.md\)/);
});

test("bundling again replaces a bundle, but never a directory this tool did not write", async () => {
  const out = join(await mkdtemp(join(tmpdir(), "bundle-")), "findings");
  await bundleInto(out);
  await writeFile(join(out, targetMissing.id, "stale.txt"), "left over");
  await bundleInto(out);
  assert.ok(!(await readdir(join(out, targetMissing.id))).includes("stale.txt"));
  const foreign = join(await mkdtemp(join(tmpdir(), "bundle-")), "findings");
  await mkdir(join(foreign, targetMissing.id), { recursive: true });
  await writeFile(join(foreign, targetMissing.id, "notes.md"), "mine");
  await assert.rejects(bundleInto(foreign), /exists and is not a finding bundle; choose another --out/);
  assert.equal(await readFile(join(foreign, targetMissing.id, "notes.md"), "utf8"), "mine");
});

test("--finding writes one bundle, and the index links only bundles that exist", async () => {
  const out = join(await mkdtemp(join(tmpdir(), "bundle-")), "findings");
  const result = await bundleInto(out, { only: focusWithoutScreenshot.id });
  assert.deepEqual(result.bundles.map((bundle) => bundle.id), [focusWithoutScreenshot.id]);
  assert.deepEqual((await readdir(out)).sort(), ["index.md", focusWithoutScreenshot.id]);
  const index = await readFile(result.index, "utf8");
  assert.match(index, /`page-arrange--data-widget-form` \|/);
  assert.doesNotMatch(index, /page-arrange--data-widget-form\/issue\.md/);
});

test("the script prints a Finding line per bundle, then the Findings line", async () => {
  const run = await runDirectory([targetMissing], { images });
  const out = join(await mkdtemp(join(tmpdir(), "bundle-")), "findings");
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", join(root, "cli/bundle.ts"), run, "--out", out], { cwd: root, env: { ...process.env, INIT_CWD: root } });
  assert.equal(stdout, `Finding: ${targetMissing.id} ${join(out, targetMissing.id, "issue.md")}\nFindings: ${join(out, "index.md")}\n`);
});
