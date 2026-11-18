import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultMaxFileBytes, reportFileLimit, ReportFileSizeError, readJsonDocument, writeJsonDocument, writeHtmlPages } from "@openuji/journey-plugin";
import type { SuiteResultBundle } from "@openuji/journey-plugin";
import { fileArtifactStore } from "../src/artifact-store.js";
import { writeReport, readReport, publishReport } from "../src/publish.js";
import { compareBundles } from "../src/compare-bundles.js";
import { openReport } from "../src/report-data.js";
import { savedTest } from "./fixtures.js";

async function temporary(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "report-storage-"));
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}
async function sizes(directory: string) {
  const paths = await readdir(directory, { recursive: true, withFileTypes: true });
  return Promise.all(paths.filter((path) => path.isFile()).map(async (path) => ({ name: join(path.parentPath, path.name), size: (await stat(join(path.parentPath, path.name))).size })));
}
function suite(): SuiteResultBundle {
  return { kind: "suite", ok: false, generatedAt: "now", tests: [{ ...savedTest(), artifacts: [] }], errors: [], artifacts: [] };
}

test("MiB policy resolves once and rejects invalid or sub-byte limits", () => {
  assert.equal(defaultMaxFileBytes, 5_242_880);
  assert.equal(reportFileLimit(), defaultMaxFileBytes);
  assert.equal(reportFileLimit(0.5), 524_288);
  for (const value of [0, -1, NaN, Infinity, "5", 1e-20, Number.MAX_SAFE_INTEGER]) assert.throws(() => reportFileLimit(value), /positive safe byte count/);
});

test("JSON documents recursively partition objects, arrays and indexes without changing domain references", async (t) => {
  const directory = await temporary(t); const store = fileArtifactStore(directory, "", 512);
  const value = JSON.parse(JSON.stringify({ "@id": "urn:document", $ref: { kind: "ref", ref: { href: "../domain-data" } },
    array: Array.from({ length: 400 }, (_, index) => ({ index, text: "é🙂".repeat(20) })),
    object: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`key-${index}`, [index, null, true]])),
    __proto__: undefined }));
  Object.defineProperty(value, "__proto__", { value: { retained: true }, enumerable: true });
  const root = await writeJsonDocument(store, { name: "document.json", value });
  assert.equal(root.storage, "json-document");
  assert.deepEqual(await readJsonDocument((ref) => store.read(ref), root), value);
  assert.ok(store.files.length > 20);
  assert.ok((await sizes(directory)).every((file) => file.size <= 512));
  const other = new Set(store.files.filter((file) => file.href !== root.href).map((file) => file.auxiliary));
  assert.deepEqual([...other], [true]);
});

test("file caps count bytes exactly and reject oversized leaves before creating a file", async (t) => {
  const directory = await temporary(t); const store = fileArtifactStore(directory, "", 512);
  await store.write({ name: "exact.png", data: new Uint8Array(512), contentType: "image/png" });
  await assert.rejects(store.write({ name: "oversize.png", data: new Uint8Array(513), contentType: "image/png" }), ReportFileSizeError);
  await assert.rejects(writeJsonDocument(store, { name: "oversize.json", value: "🙂".repeat(200) }), ReportFileSizeError);
  await assert.rejects(access(join(directory, "oversize.png")));
  await assert.rejects(access(join(directory, "oversize.json")));
  assert.ok((await sizes(directory)).every((file) => file.size <= 512));
});

test("JSON readers reject missing, escaping, cyclic and unsupported document references", async (t) => {
  const directory = await temporary(t); const store = fileArtifactStore(directory);
  await assert.rejects(readJsonDocument((ref) => store.read(ref), { href: "../outside.json" }), /relative evidence/);
  await assert.rejects(readJsonDocument((ref) => store.read(ref), { href: "missing.json" }), /ENOENT/);
  await store.write({ name: "cycle.json", data: JSON.stringify({ format: "journey-mesh/json-document", version: 1, kind: "concat", collection: "array", parts: [{ href: "cycle.json" }] }), contentType: "application/json" });
  await assert.rejects(readJsonDocument((ref) => store.read(ref), { href: "cycle.json" }), /Cyclic/);
  await store.write({ name: "future.json", data: JSON.stringify({ format: "journey-mesh/json-document", version: 99 }), contentType: "application/json" });
  await assert.rejects(readJsonDocument((ref) => store.read(ref), { href: "future.json" }), /Unsupported/);
});

test("HTML pages split complete sections and retain bounded fragment navigation", async (t) => {
  const directory = await temporary(t); const store = fileArtifactStore(directory, "", 2500);
  const first = await writeHtmlPages(store, { name: "detail.html", header: "<!doctype html><html><body><main>", footer: "</main></body></html>",
    sections: Array.from({ length: 20 }, (_, index) => `<section id="node-${index}">${"text ".repeat(90)}</section>`) });
  assert.equal(first.href, "detail.html");
  assert.ok(store.files.length > 2);
  const combined = (await Promise.all(store.files.map((file) => store.read(file)))).map((bytes) => new TextDecoder().decode(bytes)).join("");
  for (let index = 0; index < 20; index++) assert.equal(combined.split(`id="node-${index}"`).length, 2);
  assert.match(combined, /rel="next"/);
  assert.ok((await sizes(directory)).every((file) => file.size <= 2500));
});

test("report round-trips retain semantic data and lazy loading never reads observer evidence", async (t) => {
  const directory = await temporary(t); const original = suite();
  const item = original.tests[0];
  const report = { ...original, tests: [{ ...item, outputs: [{ id: "custom", kind: "unknown-provider", measurements: [], errors: [], evidence: { raw: "retained" } }] }] };
  await writeReport(directory, report);
  const restored = await readReport(directory, ["suite"]);
  assert.deepEqual(restored, { ...report, storage: { maxFileBytes: defaultMaxFileBytes } });
  const requests: string[] = [];
  const handle = await openReport(async ({ href }) => { requests.push(href); return readFile(join(directory, href)); });
  assert.ok(!requests.some((name) => name.includes("data/tests/")));
  const loaded = await handle.loadTest(item.id, "keyboard");
  assert.equal(loaded.result.evidence.executions.length, 1);
  assert.ok(!requests.some((name) => /observers\/\d+\/evidence/.test(name)));
  assert.match(await readFile(join(directory, "index.html"), "utf8"), /src="\.\/assets\//);
  await assert.rejects(access(join(directory, "bundle.json")));
  assert.ok((await sizes(directory)).every((file) => file.size <= defaultMaxFileBytes));
});

test("publication repacks JSON evidence under a smaller comparison policy and remains atomic on oversized assets", async (t) => {
  const directory = await temporary(t); const baseline = join(directory, "baseline"), candidate = join(directory, "candidate");
  const source = fileArtifactStore(baseline);
  const evidence = Array.from({ length: 3000 }, (_, id) => ({ id, detail: "x".repeat(220) }));
  const raw = await writeJsonDocument(source, { name: "raw.json", value: evidence });
  await writeReport(baseline, { ...suite(), artifacts: source.files });
  await writeReport(candidate, { ...suite(), storage: { maxFileBytes: 524_288 } });
  const output = join(directory, "comparison");
  await compareBundles({ baseline, candidate, outputDir: output });
  const saved = await readReport(output, ["comparison"]);
  assert.equal(saved.storage?.maxFileBytes, 524_288);
  assert.ok((await sizes(output)).every((file) => file.size <= 524_288));
  const repacked = fileArtifactStore(join(output, "subjects/baseline"));
  assert.deepEqual(await readJsonDocument((ref) => repacked.read(ref), raw), evidence);
  const target = join(directory, "published");
  await publishReport(output, target);
  const previous = await readFile(join(target, "manifest.json"), "utf8");
  const small = saved.subjects.baseline.bundle!;
  const badStore = fileArtifactStore(baseline);
  const binary = await badStore.write({ name: "big.png", data: new Uint8Array(600_000), contentType: "image/png" });
  await writeReport(baseline, { ...suite(), artifacts: [binary] });
  await assert.rejects(compareBundles({ baseline, candidate, outputDir: target }), ReportFileSizeError);
  assert.equal(await readFile(join(target, "manifest.json"), "utf8"), previous);
  assert.equal(small.kind, "suite");
});

test("legacy bundle files are rejected explicitly", async (t) => {
  const directory = await temporary(t); const path = join(directory, "bundle.json");
  await writeFile(path, JSON.stringify(suite()));
  await assert.rejects(readReport(path), /legacy bundle.json reports must be regenerated/);
});
