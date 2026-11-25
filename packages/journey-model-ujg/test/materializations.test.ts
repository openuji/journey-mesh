import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DiscoveredMaterialization } from "@openuji/journey-plugin";
import { compileUjgJourneyPlan, declareDiscoveredMaterializations, UjgCompileError } from "../src/index.js";
import { journeyMeshPlugin } from "../src/plugin.js";
import { context, fixture, type Fixture } from "./fixtures.js";

const withoutMaterialization = (): Fixture => {
  const doc = fixture();
  doc.nodes = doc.nodes.filter((node) => !["urn:material", "urn:move", "urn:activate"].includes(node["@id"]));
  (doc["@context"] as string[]).splice((doc["@context"] as string[]).indexOf(context("operability")), 1);
  return doc;
};

const found = (overrides: Partial<DiscoveredMaterialization> = {}): DiscoveredMaterialization => ({
  testId: "test", profileId: "keyboard-only", operationId: "op", transitionId: "urn:transition", modalityId: "observability:keyboard", status: "found",
  steps: [
    { kind: "move", moveKindId: "operability:previousStop" },
    { kind: "move", moveKindId: "operability:previousStop", locatorId: "urn:locator" },
    { kind: "activation" }
  ],
  ...overrides
});

const transition = async (doc: unknown) => {
  const plan = await compileUjgJourneyPlan(doc as Fixture, { journeyId: "urn:journey" });
  const operation = plan.operations.find((item) => item.kind === "transition");
  assert.equal(operation?.kind, "transition");
  return operation;
};

test("a found path becomes a linked TransitionMaterialization that compiles, without changing the input", async () => {
  const input = withoutMaterialization(), original = structuredClone(input);
  const { document, writes } = declareDiscoveredMaterializations(input, [found()]);
  assert.deepEqual(input, original);
  assert.deepEqual(writes, [{ transitionId: "urn:transition", modalityId: "observability:keyboard", outcome: "added", materializationId: "urn:materialization:transition:keyboard" }]);
  assert.ok((document["@context"] as string[]).includes(context("operability")));
  const [materialization] = (await transition(document)).materializations!;
  assert.equal(materialization.label, "Keyboard path");
  assert.deepEqual(materialization.steps.map((step) => [step.kind, step.moveKind?.id, step.locator?.id, step.previousStepId]), [
    ["move", "operability:previousStop", undefined, undefined],
    ["move", "operability:previousStop", "urn:locator", "urn:step:transition:keyboard:1"],
    ["activation", undefined, undefined, "urn:step:transition:keyboard:2"]
  ]);
});

test("transition IRIs under urn:transition: name their materialization and steps", () => {
  const doc = withoutMaterialization();
  for (const node of doc.nodes) for (const [key, value] of Object.entries(node)) if (value === "urn:transition") node[key] = "urn:transition:login:submit";
  const { document } = declareDiscoveredMaterializations(doc, [found({ transitionId: "urn:transition:login:submit", modalityId: "observability:pointer",
    steps: [{ kind: "move", moveKindId: "operability:pointAt", locatorId: "urn:locator" }, { kind: "activation" }] })]);
  const ids = document.nodes.map((node) => node["@id"]);
  assert.ok(ids.includes("urn:materialization:login:submit:pointer"));
  assert.ok(ids.includes("urn:step:login:submit:pointer:2"));
  assert.equal(document.nodes.find((node) => node["@id"] === "urn:materialization:login:submit:pointer")!.label, "Point at it and press");
});

test("a declared materialization is kept unless the path was rediscovered to replace exactly it", async () => {
  const declared = fixture();
  const kept = declareDiscoveredMaterializations(declared, [found()]);
  assert.deepEqual(kept.document, declared);
  assert.equal(kept.writes[0].outcome, "kept");
  assert.match(kept.writes[0].note!, /already declares urn:material/);

  const { document, writes } = declareDiscoveredMaterializations(declared, [found({ replaces: "urn:material" })]);
  assert.equal(writes[0].outcome, "replaced");
  const ids = document.nodes.map((node) => node["@id"]);
  assert.ok(!ids.includes("urn:move") && !ids.includes("urn:activate"));
  const [materialization] = (await transition(document)).materializations!;
  assert.equal(materialization.id, "urn:material");
  assert.equal(materialization.steps.length, 3);

  const missing = declareDiscoveredMaterializations(declared, [found({ replaces: "urn:other" })]);
  assert.equal(missing.writes[0].outcome, "kept");

  // Rediscovery found the field already focused: the replaced steps go, and nothing takes their place.
  const removed = declareDiscoveredMaterializations(declared, [found({ status: "at-target", steps: undefined, replaces: "urn:material" })]);
  assert.deepEqual(removed.writes, [{ transitionId: "urn:transition", modalityId: "observability:keyboard", outcome: "removed", materializationId: "urn:material" }]);
  assert.ok(!removed.document.nodes.some((node) => ["urn:material", "urn:move", "urn:activate"].includes(node["@id"])));
});

test("only found paths of transitions in the document are written", () => {
  const doc = withoutMaterialization();
  const { document, writes } = declareDiscoveredMaterializations(doc, [
    found({ status: "at-target", steps: undefined }),
    found({ status: "not-found", steps: undefined, note: "never reached" }),
    found({ transitionId: "urn:transition:elsewhere" })
  ]);
  assert.deepEqual(writes, []);
  assert.deepEqual(document, doc);
});

test("a document of a UJG version without a writer is rejected, never given nodes of another version", () => {
  const other = { "@context": ["https://ujg.specs.openuji.org/tr/1.0-rc9/ns/core.context.jsonld"], nodes: [] };
  assert.throws(() => declareDiscoveredMaterializations(other, [found()]), (error) => error instanceof UjgCompileError && /1\.0-rc9/.test(error.message));
});

test("the model plugin returns a rewritten local document only when something changed, and never writes it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ujg-declare-"));
  const source = join(directory, "journey.ujg.jsonld");
  const text = `${JSON.stringify(withoutMaterialization(), null, 2)}\n`;
  await writeFile(source, text);
  const compiler = await journeyMeshPlugin.create(undefined as never, {} as never);
  const declared = await compiler.declareMaterializations!(source, [found()]);
  assert.equal(declared.writes[0]?.outcome, "added");
  assert.ok(declared.document?.includes("urn:materialization:transition:keyboard"));
  assert.equal(await readFile(source, "utf8"), text, "the caller writes the document");
  const unchanged = await compiler.declareMaterializations!(source, [found({ status: "not-found", steps: undefined })]);
  assert.deepEqual(unchanged, { writes: [] });
  await assert.rejects(compiler.declareMaterializations!("https://example.org/journey.ujg.jsonld", [found()]), /only in a local UJG document/);
});

test("a canonical materialization is never replaced, and a found path is added beside it", async () => {
  const doc = fixture();
  const expected = doc.nodes.find((node) => node["@id"] === "urn:material")!;
  expected.extensions = { "urn:openuji:journey-mesh:canonical": {} };

  const added = declareDiscoveredMaterializations(doc, [found()]);
  assert.deepEqual(added.writes, [{ transitionId: "urn:transition", modalityId: "observability:keyboard", outcome: "added", materializationId: "urn:materialization:transition:keyboard" }]);
  const materializations = (await transition(added.document)).materializations!;
  assert.deepEqual(materializations.map((item) => item.id).sort(), ["urn:material", "urn:materialization:transition:keyboard"]);

  const again = declareDiscoveredMaterializations(added.document, [found()]);
  assert.equal(again.writes[0].outcome, "kept");
  assert.match(again.writes[0].note!, /already declares urn:materialization:transition:keyboard/);

  for (const entry of [found({ replaces: "urn:material" }), found({ status: "at-target", steps: undefined, replaces: "urn:material" })]) {
    const kept = declareDiscoveredMaterializations(doc, [entry]);
    assert.deepEqual(kept.document, doc);
    assert.match(kept.writes[0].note!, /urn:material is canonical, so it is never replaced/);
  }
});
