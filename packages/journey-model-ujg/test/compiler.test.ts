import assert from "node:assert/strict";
import test from "node:test";

import { compileUjgJourneyPlan, type UjgDocument } from "../src/index.js";

const document: UjgDocument = {
  "@id": "urn:test:document",
  "@type": "UJGDocument",
  nodes: [
    { "@id": "urn:composite", "@type": "CompositeState", subjourneyId: "urn:journey" },
    { "@id": "urn:journey", "@type": "Journey", defaultEntryRef: "urn:entry", entryRefs: ["urn:entry"], stateRefs: ["urn:state"], transitionRefs: [] },
    { "@id": "urn:entry", "@type": "JourneyEntry", stateRef: "urn:state" },
    { "@id": "urn:entry-binding", "@type": "EntryBinding", entryRef: "urn:entry", value: "application.entry" },
    { "@id": "urn:state", "@type": "State", label: "Ready" },
    { "@id": "urn:surface", "@type": "Surface", graphNodeRef: "urn:state" },
    { "@id": "urn:touchpoint", "@type": "Touchpoint", compositeStateRefs: ["urn:composite"] },
    { "@id": "urn:user", "@type": "User", touchpointRefs: ["urn:touchpoint"] },
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
