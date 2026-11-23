import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileUjgJourneyPlan, loadUjgDocumentGraph, parseUjgDocument, UjgCompileError } from "../src/index.js";
import { compilerRegistry } from "../src/versions/registry.js";
import { rc4Compiler } from "../src/versions/1.0-rc4/index.js";
import { context, fixture, item, type Fixture } from "./fixtures.js";

const transition = async (doc: Fixture) => {
  const plan = await compileUjgJourneyPlan(doc, { journeyId: "urn:journey" });
  const op = plan.operations.find((operation) => operation.kind === "transition")!;
  assert.equal(op.kind, "transition");
  return op;
};

test("RC4 materializations preserve compact identifiers, causal step order, and immutable provenance", async () => {
  const input = fixture(), original = structuredClone(input);
  const op = await transition(input);
  assert.deepEqual(op.materializations?.[0].steps.map((step) => step.id), ["urn:move", "urn:activate"]);
  assert.equal(op.materializations?.[0].modality.id, "observability:keyboard");
  assert.equal(op.materializations?.[0].steps[0].moveKind?.id, "operability:nextItem");
  assert.deepEqual(op.source?.references?.sourceDocumentIds, ["urn:document"]);
  assert.equal(op.source?.references?.specVersion, "1.0-rc4");
  assert.ok(Object.isFrozen(op.materializations?.[0].steps));
  assert.deepEqual(input, original);
  input.nodes.reverse(); item(input, "urn:material").materializationStepRefs = ["urn:move", "urn:activate"];
  assert.deepEqual(await transition(input), op);
});

test("full standard IRIs normalize to compact references and built-ins need no declarations", async () => {
  const doc = fixture();
  item(doc, "urn:material").materializationModalityRef = context("observability").replace(".context.jsonld", "#keyboard");
  item(doc, "urn:move").stepMoveKindRef = context("operability").replace(".context.jsonld", "#nextItem");
  assert.equal((await transition(doc)).materializations?.[0].steps[0].moveKind?.id, "operability:nextItem");
});

test("descriptive steps, final moves, opaque hints, custom kinds, and alternatives survive compilation", async () => {
  const doc = fixture();
  delete item(doc, "urn:move").stepMoveKindRef;
  item(doc, "urn:activate")["@type"] = "ShortcutStep";
  item(doc, "urn:activate").extensions = { "org.example.shortcut": { keys: ["Control", "S"] } };
  doc.nodes.push(
    { "@id": "urn:kind", "@type": "MoveKind" },
    { "@id": "urn:modality", "@type": "InputModality" },
    { "@id": "urn:other", "@type": "TransitionMaterialization", materializationTransitionRef: "urn:transition", materializationModalityRef: "urn:modality", materializationStepRefs: ["urn:final"] },
    { "@id": "urn:final", "@type": "MoveStep", stepMoveKindRef: "urn:kind" }
  );
  const mats = (await transition(doc)).materializations!;
  assert.equal(mats.length, 2);
  assert.equal(mats[0].steps[0].moveKind, undefined);
  assert.equal(mats[0].steps[1].kind, "shortcut");
  assert.deepEqual(mats[0].steps[1].extensions, { "org.example.shortcut": { keys: ["Control", "S"] } });
  assert.equal(mats[1].steps[0].moveKind?.id, "urn:kind");
});

const invalidCases: [string, (doc: Fixture) => void][] = [
  ["missing target", (d) => { item(d, "urn:material").materializationTransitionRef = "urn:missing"; }],
  ["wrong target class", (d) => { item(d, "urn:material").materializationTransitionRef = "urn:start"; }],
  ["no steps", (d) => { item(d, "urn:material").materializationStepRefs = []; }],
  ["no first step", (d) => { item(d, "urn:move").stepPreviousRef = "urn:activate"; }],
  ["multiple roots", (d) => { delete item(d, "urn:activate").stepPreviousRef; }],
  ["foreign predecessor", (d) => { item(d, "urn:move").stepPreviousRef = "urn:locator"; }],
  ["orphan step", (d) => { d.nodes.push({ "@id": "urn:orphan", "@type": "ActivationStep" }); }],
  ["shared step", (d) => { d.nodes.push({ ...item(d, "urn:material"), "@id": "urn:second" }); }],
  ["exclusive step types", (d) => { item(d, "urn:move")["@type"] = ["MoveStep", "ActivationStep"]; }],
  ["move kind on activation", (d) => { item(d, "urn:activate").stepMoveKindRef = "operability:nextStop"; }],
  ["direction on ordinary transition", (d) => { item(d, "urn:material").materializationDirectionRef = "operability:forward"; }],
  ["unknown direction", (d) => { item(d, "urn:material").materializationDirectionRef = "operability:sideways"; }],
  ["pointer focus move", (d) => { item(d, "urn:material").materializationModalityRef = "observability:pointer"; }],
  ["keyboard pointAt", (d) => { item(d, "urn:move").stepMoveKindRef = "operability:pointAt"; }],
  ["illegal source State", (d) => { item(d, "urn:material").materializationSourceStateRef = "urn:start"; }],
  ["automatic continuation", (d) => { item(d, "urn:transition").fromExitRef = "urn:done"; }],
  ["reserved legacy modality", (d) => { d.nodes.push({ "@id": "observability:keyboard-enter", "@type": "InputModality" }); }]
];
for (const [name, change] of invalidCases) test(`invalid RC4: ${name}`, async () => {
  const doc = fixture(); change(doc);
  await assert.rejects(loadUjgDocumentGraph(doc), (error: unknown) => error instanceof UjgCompileError && error.code === "invalid-document");
});

test("forks and disconnected cycles fail independently of step reference ordering", async () => {
  for (const cycle of [false, true]) {
    const doc = fixture();
    item(doc, "urn:material").materializationStepRefs = ["urn:move", "urn:activate", "urn:extra", "urn:extra2"];
    doc.nodes.push({ "@id": "urn:extra", "@type": "ActivationStep", stepPreviousRef: cycle ? "urn:extra2" : "urn:move" }, { "@id": "urn:extra2", "@type": "ActivationStep", stepPreviousRef: "urn:extra" });
    await assert.rejects(loadUjgDocumentGraph(doc), /same predecessor|disconnected or cyclic/);
  }
});

test("pointer pointAt may be descriptive and does not require a locator at compile time", async () => {
  const doc = fixture(); item(doc, "urn:material").materializationModalityRef = "observability:pointer";
  item(doc, "urn:move").stepMoveKindRef = "operability:pointAt"; delete item(doc, "urn:move").stepLocatorRef;
  assert.equal((await transition(doc)).materializations?.[0].steps[0].locator, undefined);
});

test("all standard move kinds compile without invented gestures or serialized declarations", async () => {
  for (const kind of ["nextStop", "previousStop", "nextItem", "previousItem", "firstItem", "lastItem", "pointAt", "nextPage", "previousPage"]) {
    const doc = fixture(); item(doc, "urn:move").stepMoveKindRef = `operability:${kind}`;
    if (kind === "pointAt") item(doc, "urn:material").materializationModalityRef = "observability:pointer";
    const result = (await transition(doc)).materializations![0].steps[0];
    assert.equal(result.moveKind?.id, `operability:${kind}`);
    assert.equal("keys" in result, false);
  }
});

test("source-State and start-locator contracts are preserved for nested composite actions", async () => {
  const doc = fixture();
  // An unrelated, valid parent declaration exercises Operability validation without lowering it.
  doc.nodes.push(
    { "@id": "urn:parent-action", "@type": "Transition", from: "urn:composite", to: "urn:composite" },
    { "@id": "urn:parent-material", "@type": "TransitionMaterialization", materializationTransitionRef: "urn:parent-action", materializationModalityRef: "observability:keyboard", materializationSourceStateRef: "urn:start", materializationStartLocatorRef: "urn:locator", materializationStepRefs: ["urn:parent-step"] },
    { "@id": "urn:parent-step", "@type": "ActivationStep" }
  );
  await loadUjgDocumentGraph(doc);
  item(doc, "urn:material").materializationStartLocatorRef = "urn:locator";
  assert.equal((await transition(doc)).materializations![0].startLocator?.id, "urn:locator");
});

test("unsupported and malformed canonical input never silently loses behavior", async () => {
  for (const change of [
    (doc: Fixture) => { item(doc, "urn:move").keys = ["ArrowRight"]; },
    (doc: Fixture) => { item(doc, "urn:move")["@context"] = { Alias: "MoveStep" }; },
    (doc: Fixture) => { item(doc, "urn:locator").selector = "button"; }
  ]) {
    const doc = fixture(); change(doc); await assert.rejects(loadUjgDocumentGraph(doc), /unsupported-feature/);
  }
  assert.throws(() => parseUjgDocument("{broken"), (error: unknown) => error instanceof UjgCompileError && error.code === "invalid-document");
  const doc = fixture(); delete (doc as Partial<Fixture>)["@context"];
  await assert.rejects(compileUjgJourneyPlan(doc), /@context/);
  const graph = await loadUjgDocumentGraph(fixture());
  await assert.rejects(compileUjgJourneyPlan(structuredClone(graph)), /created by loadUjgDocumentGraph/);
});

test("all four materialization target classes validate; unsupported selected topology fails lowering", async () => {
  for (const type of ["AdjacentTransition", "OutgoingTransition", "InvokingTransition"]) {
    const doc = fixture(), target = item(doc, "urn:transition"), material = item(doc, "urn:material");
    target["@type"] = type; delete target.commandRef;
    if (type === "AdjacentTransition") material.materializationDirectionRef = "operability:backward";
    else {
      delete target.from; delete target.to; target.toEntryRef = "urn:entry";
      item(doc, "urn:journey").transitionRefs = []; item(doc, "urn:start").entryTransitionRefs = ["urn:transition"];
      material.materializationSourceStateRef = "urn:start";
      if (type === "InvokingTransition") {
        doc.nodes.push({ "@id": "urn:exit", "@type": "JourneyExit" }); item(doc, "urn:journey").exitRefs = ["urn:exit"];
      }
    }
    await loadUjgDocumentGraph(doc);
    await assert.rejects(compileUjgJourneyPlan(doc), (error: unknown) => error instanceof UjgCompileError && error.code === "unsupported-feature");
  }
});

test("missing optional lowering contracts are unsupported features, not invalid RC4", async () => {
  const doc = fixture(); delete item(doc, "urn:journey").defaultEntryRef;
  await loadUjgDocumentGraph(doc);
  await assert.rejects(compileUjgJourneyPlan(doc), /unsupported-feature.*defaultEntryRef/);
});

test("version routing rejects missing, mixed, legacy, ED, aliases, and unknown contexts", () => {
  for (const version of ["1.0-rc3", "1.0-rc5", "ed"]) {
    const doc = fixture(); doc["@context"] = [context("core").replace("1.0-rc4", version)];
    assert.throws(() => parseUjgDocument(JSON.stringify(doc)), /unsupported-version/);
  }
  for (const contexts of [[], [context("core"), context("graph").replace("rc4", "rc3")], [context("core"), { Alias: "State" }], [context("core"), context("invented")]]) {
    assert.throws(() => parseUjgDocument(JSON.stringify({ ...fixture(), "@context": contexts })), UjgCompileError);
  }
  const doc = fixture(); doc["@context"] = (doc["@context"] as string[]).filter((url) => url !== context("operability"));
  assert.throws(() => parseUjgDocument(JSON.stringify(doc)), /requires its RC4 operability context/);
});

test("aggregate context plus optional module contexts is accepted", async () => {
  const doc = fixture(); doc["@context"] = [context("core").replace("core.context", "context"), ...doc["@context"] as string[]];
  assert.equal((await transition(doc)).materializations?.length, 1);
});

test("registering a second compiler leaves RC4 selection and fixed output unchanged", async () => {
  const next = { ...rc4Compiler, version: "1.0-rc5", compile: () => { throw new Error("RC5 must not receive RC4 input"); } };
  const registry = compilerRegistry([rc4Compiler, next]);
  assert.equal(registry.select({ "@context": context("core").replace("rc4", "rc5") }), next);
  const graph = await loadUjgDocumentGraph(fixture());
  assert.equal(registry.select(graph.root), rc4Compiler);
  const result = registry.select(graph.root).compile(graph, { journeyId: "urn:journey" });
  const expected = JSON.parse(await readFile(new URL("./fixtures/rc4-plan.json", import.meta.url), "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), expected);
});
