import assert from "node:assert/strict";
import test from "node:test";

import { compileUjgJourneyPlan, toJourneyMapDocument, type UjgDocument } from "../src/index.js";
import { Registry } from "../../../vendor/journey-path/src/data/parser.js";

const document: UjgDocument = {
  "@id": "urn:test:document",
  "@type": "UJGDocument",
  nodes: [
    { "@id": "urn:index", "@type": "JourneyEntryIndex", entryRefs: ["urn:entry"] },
    { "@id": "urn:composite", "@type": "CompositeState", subjourneyRefs: ["urn:journey"] },
    { "@id": "urn:journey", "@type": "Journey", defaultEntryRef: "urn:entry", entryRefs: ["urn:entry"], stateRefs: ["urn:state"], transitionRefs: [] },
    { "@id": "urn:entry", "@type": "JourneyEntry", stateRef: "urn:state" },
    { "@id": "urn:entry-binding", "@type": "EntryBinding", entryRef: "urn:entry", value: "application.entry" },
    { "@id": "urn:state", "@type": "State", label: "Ready" },
    { "@id": "urn:surface", "@type": "Surface", graphNodeRef: "urn:state" },
    { "@id": "urn:touchpoint", "@type": "Touchpoint", journeyRefs: ["urn:journey"] },
    { "@id": "urn:persona", "@type": "Persona", touchpointRefs: ["urn:touchpoint"] },
    { "@id": "urn:locator", "@type": "AccessibleLocator", role: "main" },
    { "@id": "urn:observation-event:presence", "@type": "ObservationEvent" },
    { "@id": "urn:observation", "@type": "ObservationBinding", observeSurfaceRef: "urn:surface", observationEventRef: "urn:observation-event:presence", expectedMatchCount: 1, locatorRefs: ["urn:locator"] },
    { "@id": "urn:phase:setup", "@type": "Phase", order: 0 },
    { "@id": "urn:step", "@type": "Step", order: 0, compositeStateRef: "urn:composite", phaseRef: "urn:phase:setup" }
  ]
};

test("compiler returns a detached deeply frozen plan with immutable setup metadata", async () => {
  const input = structuredClone(document);
  const plan = await compileUjgJourneyPlan(input, { journeyId: "urn:journey" });

  assert.deepEqual(input, document);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0]?.source?.references?.phaseId, "urn:phase:setup");
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.operations));
  assert.ok(Object.isFrozen(plan.operations[0]));
  assert.ok(Object.isFrozen(plan.operations[0]?.source?.references));
  assert.throws(() => Object.assign(plan.operations[0]!, { actorId: "changed" }), TypeError);
});

test("CustomLocator extensions remain opaque, detached data for adapter interpretation", async () => {
  const input = structuredClone(document);
  const locator = input.nodes.find((node) => node["@id"] === "urn:locator")!;
  locator["@type"] = "CustomLocator";
  delete locator.role;
  locator.extensions = { "urn:example:locator": { query: "target" } };
  const plan = await compileUjgJourneyPlan(input);
  const operation = plan.operations[0];
  assert.equal(operation.kind, "state");
  if (operation.kind !== "state") throw new Error("Expected state operation");
  const resolved = operation.target.bindings[0].locators[0];
  assert.deepEqual(resolved.extensions, locator.extensions);
  assert.ok(Object.isFrozen(resolved.extensions));
  (locator.extensions as { "urn:example:locator": { query: string } })["urn:example:locator"].query = "changed";
  assert.deepEqual(resolved.extensions, { "urn:example:locator": { query: "target" } });
});

test("command surfaces supply activation without changing the UJG transition or effect", async () => {
  const input = structuredClone(document);
  const journey = input.nodes.find((node) => node["@id"] === "urn:journey")!;
  journey.stateRefs = ["urn:state", "urn:done"]; journey.transitionRefs = ["urn:transition"];
  input.nodes.push(
    { "@id": "urn:done", "@type": "State" },
    { "@id": "urn:done-surface", "@type": "Surface", graphNodeRef: "urn:done" },
    { "@id": "urn:done-binding", "@type": "ObservationBinding", observeSurfaceRef: "urn:done-surface", observationEventRef: "urn:observation-event:presence", expectedMatchCount: 1, locatorRefs: ["urn:locator"] },
    { "@id": "urn:command", "@type": "Command" },
    { "@id": "urn:command-surface", "@type": "Surface", graphNodeRef: "urn:command" },
    { "@id": "urn:invoke", "@type": "ObservationEvent" },
    { "@id": "urn:invoke-binding", "@type": "ObservationBinding", observeSurfaceRef: "urn:command-surface", observationEventRef: "urn:invoke", locatorRefs: ["urn:locator"] },
    { "@id": "urn:effect", "@type": "Effect" },
    { "@id": "urn:transition", "@type": "Transition", from: "urn:state", to: "urn:done", commandRef: "urn:command", effectRef: "urn:effect" }
  );
  const plan = await compileUjgJourneyPlan(input);
  assert.deepEqual(plan.operations.map((operation) => operation.kind), ["state", "transition", "state"]);
  const transition = plan.operations[1];
  assert.equal(transition.kind, "transition");
  if (transition.kind !== "transition") throw new Error("Expected transition");
  assert.equal(transition.surface.id, "urn:command-surface");
  assert.equal(transition.transition.id, "urn:transition");
  assert.deepEqual(transition.effects.map((effect) => effect.id), ["urn:effect"]);
});

test("the journey map is projected from the executed JSON-LD: nested journeys, surfaces, phases and steps", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { journeyMeshPlugin } = await import("../src/plugin.js");
  const directory = await mkdtemp(join(tmpdir(), "ujg-view-"));
  const source = join(directory, "journey.ujg.jsonld");
  await writeFile(source, JSON.stringify(document));
  const compiler = await journeyMeshPlugin.create(undefined, {} as never, {});
  const view = await compiler.view!(source);
  assert.equal(view?.format, "journey-map");
  const map = view?.document as ReturnType<typeof toJourneyMapDocument>;
  assert.deepEqual(Object.keys(map.states), ["urn:composite"]);
  assert.deepEqual(map.states["urn:composite"], { type: "CompositeState", subjourney: {
    id: "urn:journey", defaultEntryRef: "urn:entry", entries: { "urn:entry": { stateRef: "urn:state" } },
    states: { "urn:state": { label: "Ready", surface: { id: "urn:surface" } } }
  } });
  assert.deepEqual(map.steps, { "urn:step": { order: 0, compositeStateRef: "urn:composite", phaseRef: "urn:phase:setup" } });
  assert.deepEqual(map.touchpoints, { "urn:touchpoint": { journeyRefs: ["urn:journey"] } });
  assert.deepEqual(map.users, { "urn:persona": { touchpointRefs: ["urn:touchpoint"] } });
  const registry = new Registry(structuredClone(map) as never);
  assert.equal(registry.getRootStartOptions()[0].stateRef, "urn:composite");
  assert.deepEqual(registry.getJourneyProperties("urn:composite").users, [{ id: "urn:persona", label: undefined }]);
  assert.throws(() => toJourneyMapDocument({ ...document, nodes: document.nodes.filter((node) => node["@id"] !== "urn:journey") }), /missing node urn:journey/);
});
