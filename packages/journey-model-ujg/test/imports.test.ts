import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer, type ServerResponse } from "node:http";
import test from "node:test";
import { compileUjgJourneyPlan, loadUjgDocumentGraph, toJourneyMapDocument, UjgCompileError } from "../src/index.js";
import { journeyMeshPlugin } from "../src/plugin.js";
import { context, fixture } from "./fixtures.js";

test("nested relative file imports use retrieval locations, including import-only roots and cycles", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ujg-import-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "shared"));
  const root = { "@id": "https://wrong.example/root", "@type": "UJGDocument", "@context": [context("core")], imports: ["./shared/model.json", "./shared/leaf.json"] };
  const model = { ...fixture(), imports: ["../root.json", "./leaf.json"] };
  const leaf = { "@id": "urn:leaf", "@type": "UJGDocument", "@context": [context("core")], imports: ["../root.json"] };
  await writeFile(join(directory, "root.json"), JSON.stringify(root));
  await writeFile(join(directory, "shared/model.json"), JSON.stringify(model));
  await writeFile(join(directory, "shared/leaf.json"), JSON.stringify(leaf));
  const graph = await loadUjgDocumentGraph(join(directory, "root.json"));
  assert.equal(graph.documents.length, 3);
  assert.equal(graph.root.nodes, undefined);
  assert.ok(Object.isFrozen(graph.nodes));
  const plan = await compileUjgJourneyPlan(graph, { journeyId: "urn:journey" });
  assert.equal(plan.operations.length, 3);
  assert.equal(plan.source?.documentId, "https://wrong.example/root");
  assert.deepEqual(plan.operations[1].source?.references?.sourceDocumentIds, ["urn:document"]);
  assert.ok(toJourneyMapDocument(graph).states["urn:composite"]);
  await assert.rejects(loadUjgDocumentGraph(root), /requires documentUrl/);
  assert.equal((await loadUjgDocumentGraph(root, { documentUrl: pathToFileURL(join(directory, "root.json")) })).nodes.length, graph.nodes.length);
  assert.throws(() => toJourneyMapDocument(root), /loadUjgDocumentGraph first/);
});

test("identical definitions deduplicate; differing definitions name both source documents", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ujg-duplicates-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const root = { ...fixture(), imports: ["./shared.json"] };
  const shared = { "@id": "urn:shared", "@type": "UJGDocument", "@context": [context("core"), context("graph")], nodes: [{ "@id": "urn:start", "@type": "State" }] };
  await writeFile(join(directory, "shared.json"), JSON.stringify(shared));
  const options = { documentUrl: pathToFileURL(join(directory, "root.json")) };
  const graph = await loadUjgDocumentGraph(root, options);
  assert.equal(graph.nodes.filter((node) => node["@id"] === "urn:start").length, 1);
  assert.deepEqual(graph.nodeSources["urn:start"], ["urn:document", "urn:shared"]);
  await writeFile(join(directory, "shared.json"), JSON.stringify({ ...shared, nodes: [{ ...shared.nodes[0], label: "Different" }] }));
  await assert.rejects(loadUjgDocumentGraph(root, options), /unsupported-feature.*Overlapping definitions.*urn:document.*urn:shared/);
});

test("failed local imports include the complete importer chain", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ujg-missing-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const root = { ...fixture(), imports: ["./middle.json"] };
  await writeFile(join(directory, "middle.json"), JSON.stringify({ "@context": context("core"), "@id": "urn:middle", "@type": "UJGDocument", imports: ["./missing.json"] }));
  await assert.rejects(loadUjgDocumentGraph(root, { documentUrl: pathToFileURL(join(directory, "root.json")) }), /root.json.*middle.json.*missing.json/);
});

test("HTTP imports follow redirect bases, reuse dependencies, support cycles and reject bad responses", async (t) => {
  const counts = new Map<string, number>();
  const send = (res: ServerResponse, value: unknown) => { res.setHeader("content-type", "application/ld+json"); res.end(JSON.stringify(value)); };
  const server = createServer((req, res) => {
    const path = req.url!; counts.set(path, (counts.get(path) ?? 0) + 1);
    if (path === "/entry") { res.writeHead(302, { location: "/root" }); res.end(); return; }
    if (path === "/root") return send(res, { "@context": context("core"), "@id": "urn:root", "@type": "UJGDocument", imports: ["./redirect", "./mirror", "./shared"] });
    if (path === "/redirect" || path === "/mirror") { res.writeHead(302, { location: "/nested/model" }); res.end(); return; }
    if (path === "/loop") { res.writeHead(302, { location: "/loop" }); res.end(); return; }
    if (path === "/nested/model") return send(res, { ...fixture(), imports: ["./leaf", "../shared", "../root"] });
    if (path === "/nested/leaf" || path === "/shared") return send(res, { "@context": context("core"), "@id": `urn:${path}`, "@type": "UJGDocument", imports: ["/root"] });
    if (path === "/bad") { res.end("invalid JSON"); return; }
    if (path === "/legacy") return send(res, { ...fixture(), "@context": context("core").replace("rc4", "rc3") });
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const graph = await loadUjgDocumentGraph(`${base}/entry`);
  assert.equal(graph.documents.length, 4);
  assert.equal(counts.get("/nested/leaf"), 1);
  assert.equal(counts.get("/shared"), 1);
  assert.equal(counts.get("/root"), 1);
  assert.equal(counts.get("/entry"), 1);
  assert.equal(counts.get("/nested/model"), 1);
  assert.equal((await compileUjgJourneyPlan(graph, { journeyId: "urn:journey" })).operations.length, 3);
  for (const [path, pattern] of [["missing", /HTTP 404/], ["bad", /JSON/], ["legacy", /unsupported-version/]] as const) {
    await assert.rejects(loadUjgDocumentGraph({ ...fixture(), imports: [`${base}/${path}`] }), pattern);
  }
  await assert.rejects(loadUjgDocumentGraph(`${base}/loop`), /excessive HTTP redirects/);
});

test("model plugin compile and view share one HTTP snapshot", async (t) => {
  let calls = 0;
  const server = createServer((_req, res) => { calls++; res.end(JSON.stringify(fixture())); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/model`;
  const compiler = await journeyMeshPlugin.create(undefined, {} as never);
  await compiler.compile(url, "urn:journey");
  const view = await compiler.view!(url);
  assert.equal(view?.format, "journey-map");
  assert.equal(calls, 1);
});

test("context URLs never trigger network retrieval; unsupported protocols fail explicitly", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unexpected network access"); };
  try {
    assert.equal((await compileUjgJourneyPlan(fixture())).operations.length, 3);
    await assert.rejects(loadUjgDocumentGraph({ ...fixture(), imports: ["ftp://example.test/model"] }), (error: unknown) => error instanceof UjgCompileError && error.code === "unsupported-feature");
  } finally { globalThis.fetch = original; }
});
