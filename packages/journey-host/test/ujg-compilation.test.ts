import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileTest } from "../src/compile.js";
import type { TestConfig } from "../src/config/schema.js";
import { journeyMeshPlugin } from "../../journey-model-ujg/src/plugin.js";
import { fixture } from "../../journey-model-ujg/test/fixtures.js";

test("RC4 materializations and imported provenance survive host plan composition", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ujg-host-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const document = fixture(), nodes = document.nodes;
  document.nodes = []; document.imports = ["./nodes.json"];
  await writeFile(join(directory, "root.json"), JSON.stringify(document));
  await writeFile(join(directory, "nodes.json"), JSON.stringify({ ...document, "@id": "urn:imported", nodes, imports: [] }));
  const compiler = await journeyMeshPlugin.create(undefined, {} as never);
  const compiled = await compileTest({
    id: "test", profiles: [], services: [], journeys: [{ id: "pages", adapter: "web", select: "urn:journey", source: "./root.json", operations: { selectTab: "urn:transition" } }]
  } satisfies TestConfig, compiler, join(directory, "mesh.yaml"), {});
  const operation = compiled.plan.operations.find((item) => item.kind === "transition")!;
  assert.equal(operation.kind, "transition");
  assert.equal(operation.segment, "pages");
  assert.equal(operation.source?.references?.specVersion, "1.0-rc4");
  assert.deepEqual(operation.source?.references?.sourceDocumentIds, ["urn:imported"]);
  assert.equal(operation.materializations?.[0].id, "urn:material");
  assert.equal(compiled.aliases.get("pages.selectTab"), operation.id);
  assert.ok(Object.isFrozen(operation.materializations?.[0].steps));
  assert.equal(compiled.views.get("root.json")?.format, "journey-map");
});

test("a keyboard transition without declared steps fails profile preflight before any setup", async (t) => {
  const { stringify } = await import("yaml");
  const { validateSuite } = await import("../src/index.js");
  const { access } = await import("node:fs/promises");
  const directory = await mkdtemp(join(tmpdir(), "ujg-preflight-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packages = new URL("../../", import.meta.url).pathname;
  const config = {
    kind: "suite", outputDir: "reports", model: { use: join(packages, "journey-model-ujg/src/plugin.ts") },
    profiles: { keyboard: { use: join(packages, "journey-profiles/src/plugin.ts"), options: { preset: "keyboard-only" } } },
    adapters: { web: { use: new URL("./fixtures/adapter.mjs", import.meta.url).pathname, options: { name: "web", log: "events.jsonl" } } },
    tests: { pages: { journeys: [{ id: "pages", source: "model.json", select: "urn:journey", adapter: "web" }], profiles: [{ id: "keyboard-only", journeys: { pages: "keyboard" } }] } }
  };
  await writeFile(join(directory, "mesh.yaml"), stringify(config));
  const document = fixture();
  await writeFile(join(directory, "model.json"), JSON.stringify(document));
  assert.deepEqual((await validateSuite(join(directory, "mesh.yaml"))).tests, ["pages"]);
  document.nodes = document.nodes.filter((node) => !["urn:material", "urn:move", "urn:activate"].includes(node["@id"]));
  await writeFile(join(directory, "model.json"), JSON.stringify(document));
  await assert.rejects(validateSuite(join(directory, "mesh.yaml")), /Transition urn:transition has no TransitionMaterialization through observability:keyboard \(profile keyboard-only\)/);
  await assert.rejects(access(join(directory, "events.jsonl")));
});
