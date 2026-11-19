import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildReport, loadReportModel } from "@openuji/journey-reporter";
import { runReader } from "@openuji/journey-run-record/node";
import { defaultMaxFileBytes, reportFileLimit, ReportFileSizeError, writeJsonDocument } from "../cli/json-document.js";
import { publishSite } from "../cli/site.js";
import { readJson } from "../src/json-document.js";
import { fixtureConfig, savedTest, suiteRun, writeRun } from "../../../packages/journey-reporter/test/fixtures.js";

async function temporary(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "site-"));
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}
async function sizes(directory: string) {
  const paths = await readdir(directory, { recursive: true, withFileTypes: true });
  return Promise.all(paths.filter((path) => path.isFile()).map(async (path) => ({ name: join(path.parentPath, path.name), size: (await stat(join(path.parentPath, path.name))).size })));
}
const fileWriter = (directory: string, maxFileBytes: number) => ({ maxFileBytes, async write(name: string, data: string) {
  await mkdir(dirname(join(directory, name)), { recursive: true }); await writeFile(join(directory, name), data);
} });

test("MiB limits resolve once and reject invalid or sub-byte values", () => {
  assert.equal(defaultMaxFileBytes, 5_242_880);
  assert.equal(reportFileLimit(), defaultMaxFileBytes);
  assert.equal(reportFileLimit(0.5), 524_288);
  for (const value of [0, -1, NaN, Infinity, "5", 1e-20, Number.MAX_SAFE_INTEGER]) assert.throws(() => reportFileLimit(value), /positive safe byte count/);
});

test("JSON documents recursively partition objects, arrays and indexes without changing domain references", async (t) => {
  const directory = await temporary(t);
  const value = JSON.parse(JSON.stringify({ "@id": "urn:document", $ref: { kind: "ref", ref: { href: "../domain-data" } },
    array: Array.from({ length: 400 }, (_, index) => ({ index, text: "é🙂".repeat(20) })),
    object: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`key-${index}`, [index, null, true]])) }));
  Object.defineProperty(value, "__proto__", { value: { retained: true }, enumerable: true });
  await writeJsonDocument(fileWriter(directory, 512), "nested/document.json", value);
  const read = runReader(directory);
  assert.deepEqual(await readJson(read, "nested/document.json"), value);
  const files = await sizes(directory);
  assert.ok(files.length > 20);
  assert.ok(files.every((file) => file.size <= 512));
  await writeFile(join(directory, "plain.json"), JSON.stringify({ format: "journey-mesh/axe-path", items: [] }));
  assert.deepEqual(await readJson(read, "plain.json"), { format: "journey-mesh/axe-path", items: [] });
});

test("oversized leaves are rejected; readers reject escaping, cyclic and unsupported references", async (t) => {
  const directory = await temporary(t);
  await assert.rejects(writeJsonDocument(fileWriter(directory, 512), "oversize.json", "🙂".repeat(200)), ReportFileSizeError);
  await assert.rejects(access(join(directory, "oversize.json")));
  const read = runReader(directory);
  await assert.rejects(readJson(read, "../outside.json"), /Invalid run record reference/);
  await assert.rejects(readJson(read, "missing.json"), /ENOENT/);
  await writeFile(join(directory, "cycle.json"), JSON.stringify({ format: "journey-mesh/json-document", version: 1, kind: "concat", collection: "array", parts: [{ href: "cycle.json" }] }));
  await assert.rejects(readJson(read, "cycle.json"), /Cyclic/);
  await writeFile(join(directory, "future.json"), JSON.stringify({ format: "journey-mesh/json-document", version: 99 }));
  await assert.rejects(readJson(read, "future.json"), /Unsupported/);
});

test("sites apply the hosting limit: large JSON is chunked and still loads; site files cannot replace run data", async (t) => {
  const directory = await temporary(t);
  const record = { ...savedTest(), observers: [{ id: "nodes", kind: "fixture-nodes", measurements: [], errors: [],
    evidence: { nodes: [], data: [{ name: "large.json", format: "fixture/large", value: Array.from({ length: 2000 }, (_, index) => ({ index, text: "x".repeat(40) })) }] } }] };
  const run = await writeRun(join(directory, "run"), suiteRun([record]));
  await buildReport(run, { config: fixtureConfig() });
  const site = join(directory, "site");
  await publishSite(run, site, { maxFileBytes: 16_384, files: [{ name: "index.html", data: "viewer shell" }] });
  assert.ok((await sizes(site)).every((file) => file.size <= 16_384));
  await access(join(site, "index.html"));
  const read = runReader(site);
  const report = await loadReportModel((href) => readJson(read, href));
  const test = await report.loadTest("manual-plan");
  assert.equal((await report.readJson<unknown[]>(test.data[0].href)).length, 2000);
  // The run directory itself is never chunked.
  assert.ok(Array.isArray(JSON.parse(await readFile(join(run, test.data[0].href), "utf8"))));
  await assert.rejects(publishSite(run, join(directory, "collision"), { files: [{ name: "run.json", data: "{}" }] }), /would replace run data/);
  await writeFile(join(run, "tests/manual-plan/files/right.png"), new Uint8Array(20_000));
  await assert.rejects(publishSite(run, join(directory, "too-large"), { maxFileBytes: 16_384 }), ReportFileSizeError);
});
