import { keyboardInputModalityId, keyboardTextEntryInputModalityId, pointerInputModalityId } from "@openuji/journey-execution-model";
import type { DiscoveredMaterialization, DiscoveredMaterializationStep, MaterializationWrite } from "@openuji/journey-plugin";
import type { UjgJsonDocument } from "../../document.js";

/**
 * Declares discovered paths in a UJG 1.0 RC4 JSON-LD document, so that a found path becomes
 * model content an author reviews like any other. It writes only what a discovery reported:
 * one TransitionMaterialization per transition and modality, with its steps linked by
 * stepPreviousRef.
 */

type JsonNode = UjgJsonDocument["nodes"][number];

const suffixes: Readonly<Record<string, string>> = {
  [keyboardInputModalityId]: "keyboard",
  [pointerInputModalityId]: "pointer",
  [keyboardTextEntryInputModalityId]: "text-entry"
};
const labels: Readonly<Record<string, string>> = {
  keyboard: "Keyboard path",
  pointer: "Point at it and press",
  "text-entry": "Focus moves to the field"
};

const types = (node: Record<string, unknown>): unknown[] => Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
const slug = (value: string) => value.replace(/[^A-Za-z0-9._:-]+/g, "-");

/** The IRI part that names a transition: `urn:transition:x:y` gives `x:y`. */
function transitionName(transitionId: string): string {
  return slug(transitionId.startsWith("urn:transition:") ? transitionId.slice("urn:transition:".length) : transitionId.replace(/^urn:/, ""));
}

/**
 * Return a copy of `document` with each found path declared. A transition that already declares
 * a materialization through the modality keeps it, unless the path was rediscovered to replace
 * exactly that materialization (`replaces`). A rediscovered `at-target` entry removes the replaced
 * materialization: the field has focus already. Entries for transitions outside the document are ignored.
 */
export function declareRc4Materializations(document: unknown, found: readonly DiscoveredMaterialization[]): { document: UjgJsonDocument; writes: MaterializationWrite[] } {
  if (!document || typeof document !== "object" || !Array.isArray((document as UjgJsonDocument).nodes)) throw new Error("A UJG document with a nodes array is required");
  const result = structuredClone(document) as UjgJsonDocument;
  const writes: MaterializationWrite[] = [];
  const byId = () => new Map(result.nodes.map((node) => [node["@id"], node]));
  for (const entry of found) {
    const removal = entry.status === "at-target" && entry.replaces !== undefined;
    if (!removal && (entry.status !== "found" || !entry.steps?.length)) continue;
    const transition = byId().get(entry.transitionId);
    if (!transition || !types(transition).includes("Transition")) continue;
    const keep = (note: string) => writes.push({ transitionId: entry.transitionId, modalityId: entry.modalityId, outcome: "kept", note });
    const declared = result.nodes.filter((node) => types(node).includes("TransitionMaterialization")
      && node.materializationTransitionRef === entry.transitionId && node.materializationModalityRef === entry.modalityId);
    if (removal) {
      const replaced = declared.find((node) => node["@id"] === entry.replaces);
      if (!replaced) { keep(`${entry.replaces} is not declared here through ${entry.modalityId}`); continue; }
      removeMaterialization(result, replaced);
      writes.push({ transitionId: entry.transitionId, modalityId: entry.modalityId, outcome: "removed", materializationId: replaced["@id"] });
      continue;
    }
    const suffix = suffixes[entry.modalityId] ?? slug(entry.modalityId.replace(/^.*[:/#]/, ""));
    let id = `urn:materialization:${transitionName(entry.transitionId)}:${suffix}`;
    let stepBase = `urn:step:${transitionName(entry.transitionId)}:${suffix}`;
    let label = labels[suffix] ?? "Discovered path";
    if (entry.replaces) {
      const replaced = declared.find((node) => node["@id"] === entry.replaces);
      if (!replaced) { keep(`${entry.replaces} is not declared here through ${entry.modalityId}`); continue; }
      id = replaced["@id"];
      stepBase = id.startsWith("urn:materialization:") ? `urn:step:${id.slice("urn:materialization:".length)}` : `${id}:step`;
      if (typeof replaced.label === "string") label = replaced.label;
      removeMaterialization(result, replaced);
    } else if (declared.length) {
      keep(`already declares ${declared.map((node) => node["@id"]).join(", ")}`);
      continue;
    }
    const steps = entry.steps ?? [];
    const stepIds = steps.map((_step, index) => `${stepBase}:${index + 1}`);
    const taken = [id, ...stepIds].filter((candidate) => byId().has(candidate));
    if (taken.length) { keep(`the IRIs ${taken.join(", ")} are already used`); continue; }
    steps.forEach((step, index) => result.nodes.push(stepNode(step, stepIds[index], index ? stepIds[index - 1] : undefined)));
    result.nodes.push({
      "@type": "TransitionMaterialization", "@id": id, label,
      materializationTransitionRef: entry.transitionId,
      materializationModalityRef: entry.modalityId,
      materializationStepRefs: stepIds
    });
    writes.push({ transitionId: entry.transitionId, modalityId: entry.modalityId, outcome: entry.replaces ? "replaced" : "added", materializationId: id });
  }
  if (writes.some((write) => write.outcome === "added" || write.outcome === "replaced")) includeOperabilityContext(result);
  return { document: result, writes };
}

function stepNode(step: DiscoveredMaterializationStep, id: string, previous: string | undefined): JsonNode {
  return {
    "@type": step.kind === "move" ? "MoveStep" : "ActivationStep", "@id": id,
    ...(step.kind === "move" ? { stepMoveKindRef: step.moveKindId } : {}),
    ...(previous ? { stepPreviousRef: previous } : {}),
    ...(step.locatorId ? { stepLocatorRef: step.locatorId } : {})
  };
}

/** Remove a materialization and the steps no other materialization lists. */
function removeMaterialization(document: UjgJsonDocument, materialization: JsonNode): void {
  const steps = new Set(Array.isArray(materialization.materializationStepRefs) ? materialization.materializationStepRefs as string[] : []);
  for (const node of document.nodes) {
    if (node === materialization || !types(node).includes("TransitionMaterialization")) continue;
    for (const ref of Array.isArray(node.materializationStepRefs) ? node.materializationStepRefs as string[] : []) steps.delete(ref);
  }
  document.nodes = document.nodes.filter((node) => node !== materialization && !steps.has(node["@id"]));
}

/** RC4 documents list one context per module; steps need the Operability one. */
function includeOperabilityContext(document: UjgJsonDocument): void {
  const contexts = document["@context"];
  if (!Array.isArray(contexts)) return;
  const modules = contexts.filter((value): value is string => typeof value === "string" && value.endsWith(".context.jsonld"));
  if (!modules.length || modules.some((value) => value.endsWith("/operability.context.jsonld"))) return;
  const base = modules[0].slice(0, modules[0].lastIndexOf("/") + 1);
  const observability = contexts.findIndex((value) => typeof value === "string" && value.endsWith("/observability.context.jsonld"));
  contexts.splice(observability >= 0 ? observability + 1 : contexts.length, 0, `${base}operability.context.jsonld`);
}
