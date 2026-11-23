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
