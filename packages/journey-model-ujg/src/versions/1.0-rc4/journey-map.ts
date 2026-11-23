import { unsupported, type UjgDocument, type UjgNode } from "../../document.js";

/**
 * The nested journey document the journey-path renderer draws: root composite states with their
 * subjourneys inline, plus touchpoints, phases, steps, effects and messages keyed by ID.
 * It is a projection of the JSON-LD graph that is also executed, so the map and the run share one source.
 */
import type { JourneyMapDocument, Fields, MapState, MapJourney } from "../../journey-map.js";

const typeOf = (node: UjgNode) => Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
const fields = ({ "@id": _id, "@type": _type, ...rest }: UjgNode): Fields => rest;
const refs = (node: UjgNode, key: string): string[] => Array.isArray(node[key]) ? (node[key] as unknown[]).filter((item): item is string => typeof item === "string") : [];

/** Convert a UJG JSON-LD document into the journey-path renderer's document. Throws on dangling references. */
export function toJourneyMapDocument(document: UjgDocument): JourneyMapDocument {
  const byId = new Map((document.nodes ?? []).map((node) => [node["@id"], node]));
  const ofType = (type: string) => (document.nodes ?? []).filter((node) => typeOf(node).includes(type));
  const node = (id: string, context: string) => {
    const found = byId.get(id);
    if (!found) throw new Error(`${context} references missing node ${id}`);
    return found;
  };
  const keyed = (type: string) => {
    const nodes = ofType(type);
    return nodes.length ? Object.fromEntries(nodes.map((item) => [item["@id"], fields(item)])) : undefined;
  };
  const surfaceTargets = ofType("Surface").map((surface) => surface.graphNodeRef);
  if (new Set(surfaceTargets).size !== surfaceTargets.length) unsupported("Map projection requires one Surface per Graph node");
  const surfaces = new Map(ofType("Surface").flatMap((surface) => typeof surface.graphNodeRef === "string"
    ? [[surface.graphNodeRef, { id: surface["@id"], ...(surface.label ? { label: surface.label } : {}) }] as const] : []));

  const state = (id: string, journey: string): MapState => {
    const item = node(id, journey);
    if (typeOf(item).includes("CompositeState")) {
      if (refs(item, "subjourneyRefs").length !== 1) unsupported(`Map projection requires one child Journey for ${id}`);
      const [subjourney] = refs(item, "subjourneyRefs");
      if (!subjourney) throw new Error(`Composite state ${id} has no subjourney`);
      return { type: "CompositeState", ...(item.label ? { label: item.label } : {}), subjourney: build(subjourney) };
    }
    const surface = surfaces.get(id);
    return { ...(item.label ? { label: item.label } : {}), ...(surface ? { surface } : {}) };
  };
  const active = new Set<string>();
  const build = (id: string): MapJourney => {
    if (active.has(id)) unsupported(`Map projection cannot expand recursive Journey ${id}`);
    active.add(id);
    const journey = node(id, "Composite state");
    const exits = refs(journey, "exitRefs");
    const transitions = refs(journey, "transitionRefs").map((ref) => {
      const transition = node(ref, id);
      const surface = typeof transition.commandRef === "string" ? surfaces.get(transition.commandRef) : undefined;
      return { id: ref, ...fields(transition), ...(surface ? { surface } : {}) };
    });
    const result = {
      id, ...(journey.label ? { label: journey.label } : {}),
      ...(typeof journey.defaultEntryRef === "string" ? { defaultEntryRef: journey.defaultEntryRef } : {}),
      entries: Object.fromEntries(refs(journey, "entryRefs").map((ref) => [ref, fields(node(ref, id))])),
      states: Object.fromEntries(refs(journey, "stateRefs").map((ref) => [ref, state(ref, id)])),
      ...(exits.length ? { exits: Object.fromEntries(exits.map((ref) => [ref, fields(node(ref, id))])) } : {}),
      ...(transitions.length ? { transitions } : {})
    };
    active.delete(id);
    return result;
  };

  // Root composites are the ones no journey contains; nested composites are drawn inside their parent.
  const nested = new Set(ofType("Journey").flatMap((journey) => refs(journey, "stateRefs")));
  const roots = ofType("CompositeState").filter((composite) => !nested.has(composite["@id"]));
  if (ofType("Journey").length && !roots.length) unsupported("Map projection requires root composites and cannot expand recursive-only topology");
  const [index] = ofType("JourneyEntryIndex");
  const result: JourneyMapDocument = {
    states: Object.fromEntries(roots.map((composite) => [composite["@id"], state(composite["@id"], "Document")])),
    ...(index ? { journeyEntryIndex: { id: index["@id"], ...fields(index) } } : {})
  };
  for (const [key, type] of [["touchpoints", "Touchpoint"], ["users", "Persona"], ["artifacts", "Artifact"], ["effects", "Effect"], ["locales", "Locale"], ["messageMeta", "MessageMeta"], ["messages", "Message"], ["phases", "Phase"], ["steps", "Step"]] as const) {
    const values = keyed(type);
    if (values) result[key] = values;
  }
  return result;
}
