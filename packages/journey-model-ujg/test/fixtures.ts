import type { UjgDocument, UjgNode } from "../src/index.js";

export const context = (module: string) => `https://ujg.specs.openuji.org/tr/1.0-rc4/ns/${module}.context.jsonld`;
export type Fixture = UjgDocument & { nodes: UjgNode[] };
export function fixture(): Fixture {
  return {
    "@context": ["core", "graph", "surface", "observability", "operability", "l10n", "phase", "entry-binding"].map(context),
    "@id": "urn:document", "@type": "UJGDocument", nodes: [
      { "@id": "urn:composite", "@type": "CompositeState", subjourneyRefs: ["urn:journey"] },
      { "@id": "urn:journey", "@type": "Journey", entryRefs: ["urn:entry"], defaultEntryRef: "urn:entry", stateRefs: ["urn:start", "urn:done"], transitionRefs: ["urn:transition"] },
      { "@id": "urn:entry", "@type": "JourneyEntry", stateRef: "urn:start" },
      { "@id": "urn:start", "@type": "State" }, { "@id": "urn:done", "@type": "State" },
      { "@id": "urn:transition", "@type": "Transition", from: "urn:start", to: "urn:done", commandRef: "urn:command" },
      { "@id": "urn:command", "@type": "Command" },
      ...["start", "done", "command"].flatMap((name) => [
        { "@id": `urn:surface:${name}`, "@type": "Surface", graphNodeRef: `urn:${name}` },
        { "@id": `urn:binding:${name}`, "@type": "ObservationBinding", observeSurfaceRef: `urn:surface:${name}`, observationEventRef: name === "command" ? "urn:invoke" : "urn:observation-event:presence", expectedMatchCount: 1, locatorRefs: ["urn:locator"] }
      ]),
      { "@id": "urn:observation-event:presence", "@type": "ObservationEvent" },
      { "@id": "urn:invoke", "@type": "ObservationEvent", requiredInputModalityProfileRefs: ["urn:profile"] },
      { "@id": "urn:profile", "@type": "InputModalityProfile", inputModalityRefs: ["observability:keyboard"] },
      { "@id": "urn:locator", "@type": "AccessibleLocator", role: "tab" },
      { "@id": "urn:touchpoint", "@type": "Touchpoint", journeyRefs: ["urn:journey"] },
      { "@id": "urn:persona", "@type": "Persona", touchpointRefs: ["urn:touchpoint"] },
      { "@id": "urn:phase", "@type": "Phase", order: 0 },
      { "@id": "urn:step", "@type": "Step", compositeStateRef: "urn:composite", phaseRef: "urn:phase", order: 0 },
      { "@id": "urn:material", "@type": "TransitionMaterialization", materializationTransitionRef: "urn:transition", materializationModalityRef: "observability:keyboard", materializationStepRefs: ["urn:activate", "urn:move"] },
      { "@id": "urn:move", "@type": "MoveStep", stepMoveKindRef: "operability:nextItem", stepLocatorRef: "urn:locator" },
      { "@id": "urn:activate", "@type": "ActivationStep", stepPreviousRef: "urn:move", stepLocatorRef: "urn:locator" }
    ]
  };
}
export function item(document: Fixture, id: string): UjgNode { return document.nodes.find((node) => node["@id"] === id)!; }
