import { invalid, unsupported, types, type ResolvedUjgDocumentGraph, type UjgNode } from "../../document.js";
import { referenceProperties, standardNodes, termModules } from "./vocabulary.js";

export type Rc4Index = Map<string, UjgNode>;
export const has = (node: UjgNode, type: string) => types(node).includes(type);
export function node(index: Rc4Index, id: unknown, allowed?: readonly string[]): UjgNode {
  if (typeof id !== "string") invalid(`Expected one reference, got ${JSON.stringify(id)}`);
  const found = index.get(id);
  if (!found) invalid(`Missing UJG node ${id}`);
  if (allowed && !allowed.some((type) => has(found, type))) invalid(`${id} must reference ${allowed.join(" or ")}`);
  return found;
}
export function refs(value: unknown): string[] { return value === undefined ? [] : value as string[]; }
export function indexGraph(graph: ResolvedUjgDocumentGraph): Rc4Index {
  const index = new Map(standardNodes.map((item) => [item["@id"], item]));
  for (const item of graph.nodes) {
    const standard = index.get(item["@id"]);
    if (standard && !has(item, standard["@type"] as string)) invalid(`${item["@id"]} cannot redefine a standard individual`);
    if ((/^(observability|operability):/.test(item["@id"]) || /^https:\/\/ujg\.specs\.openuji\.org\/tr\/[^/]+\/ns\/(observability|operability)#/.test(item["@id"])) && !standard) invalid(`Unknown reserved standard individual ${item["@id"]}; use a producer IRI`);
    index.set(item["@id"], item);
  }
  return index;
}

export function validateRc4Graph(graph: ResolvedUjgDocumentGraph): void {
  const index = indexGraph(graph);
  const ofType = (type: string) => graph.nodes.filter((item) => has(item, type));
  for (const item of graph.nodes) {
    validateSubjects(item);
    for (const [key, value] of Object.entries(item)) if (referenceProperties.has(key)) {
      for (const ref of Array.isArray(value) ? value : [value]) node(index, ref);
    }
    if (item.expectedMatchCount !== undefined && (!Number.isInteger(item.expectedMatchCount) || Number(item.expectedMatchCount) < 0)) invalid(`${item["@id"]}.expectedMatchCount must be a non-negative integer`);
    if (item.order !== undefined && !Number.isInteger(item.order)) invalid(`${item["@id"]}.order must be an integer`);
    if (has(item, "Surface")) node(index, item.graphNodeRef, ["State", "CompositeState", "Command"]);
    if (has(item, "ObservationBinding")) {
      node(index, item.observeSurfaceRef, ["Surface"]); node(index, item.observationEventRef, ["ObservationEvent"]);
      requireRefs(item, "locatorRefs").forEach((ref) => node(index, ref, ["AccessibleLocator", "CustomLocator"]));
    }
    if (has(item, "ObservationEvent")) refs(item.requiredInputModalityProfileRefs).forEach((ref) => node(index, ref, ["InputModalityProfile"]));
    if (has(item, "InputModalityProfile")) requireRefs(item, "inputModalityRefs").forEach((ref) => node(index, ref, ["InputModality"]));
    if (has(item, "AccessibleLocator")) {
      if (!["role", "accessibleNameRef", "accessibleDescriptionRef", "accessibleFeatureRefs", "accessibleRelationRefs", "contextLocatorRefs"].some((key) => item[key] !== undefined && (!Array.isArray(item[key]) || (item[key] as unknown[]).length))) invalid(`${item["@id"]} must constrain an accessible object`);
      for (const key of ["accessibleNameRef", "accessibleDescriptionRef"]) if (item[key] !== undefined) node(index, item[key], ["MessageMeta"]);
      refs(item.accessibleFeatureRefs).forEach((ref) => node(index, ref, ["AccessibleFeature"]));
      refs(item.accessibleRelationRefs).forEach((ref) => node(index, ref, ["AccessibleRelation"]));
      refs(item.contextLocatorRefs).forEach((ref) => node(index, ref, ["AccessibleLocator", "CustomLocator"]));
    }
    if (has(item, "SurfaceInstanceResolver")) node(index, item.instanceKeyFeatureRef, ["AccessibleFeature"]);
    if (has(item, "JourneyEntry")) node(index, item.stateRef, ["State", "CompositeState"]);
    if (has(item, "CompositeState")) {
      if (has(item, "State") || has(item, "JourneyExit")) invalid(`${item["@id"]} has incompatible vertex types`);
      requireRefs(item, "subjourneyRefs").forEach((ref) => node(index, ref, ["Journey"]));
    }
    if (has(item, "EntryBinding")) node(index, item.entryRef, ["JourneyEntry"]);
    if (has(item, "Step")) { node(index, item.compositeStateRef, ["CompositeState"]); node(index, item.phaseRef, ["Phase"]); }
    if (has(item, "Touchpoint")) refs(item.journeyRefs).forEach((ref) => node(index, ref, ["Journey"]));
    if (has(item, "Persona")) refs(item.touchpointRefs).forEach((ref) => node(index, ref, ["Touchpoint"]));
    if (has(item, "State")) refs(item.entryTransitionRefs).forEach((ref) => node(index, ref, ["OutgoingTransition", "InvokingTransition"]));
    if (has(item, "Transition") || has(item, "AdjacentTransition")) {
      node(index, item.from, ["State", "CompositeState"]);
      node(index, item.to, has(item, "AdjacentTransition") ? ["State", "CompositeState"] : ["State", "CompositeState", "JourneyExit"]);
      if (has(item, "AdjacentTransition") && ["commandRef", "conditionRef", "effectRef", "fromExitRef", "toEntryRef"].some((key) => item[key] !== undefined)) invalid(`${item["@id"]}: AdjacentTransition cannot declare command, condition, effect, or entry/exit selection`);
    }
    if (item.commandRef !== undefined) node(index, item.commandRef, ["Command"]);
    if (has(item, "OutgoingTransition") || has(item, "InvokingTransition")) {
      if (item.from !== undefined || item.to !== undefined || item.fromExitRef !== undefined) invalid(`${item["@id"]}: entry transitions have no from, to, or fromExitRef`);
      if (Number(item.toEntryRef !== undefined) + Number(item.entrySelectorRef !== undefined) !== 1) invalid(`${item["@id"]}: entry transition requires exactly one destination`);
      if (item.toEntryRef !== undefined) node(index, item.toEntryRef, ["JourneyEntry"]);
      if (item.entrySelectorRef !== undefined) node(index, item.entrySelectorRef, ["EntrySelector"]);
    }
  }
  const owners = new Map<string, string>();
  for (const journey of ofType("Journey")) {
    const entries = requireRefs(journey, "entryRefs"), states = requireRefs(journey, "stateRefs");
    if (journey.defaultEntryRef !== undefined && !entries.includes(journey.defaultEntryRef as string)) invalid(`${journey["@id"]}.defaultEntryRef must belong to entryRefs`);
    for (const ref of [...entries, ...states, ...refs(journey.exitRefs)]) {
      const previous = owners.get(ref);
      if (previous && previous !== journey["@id"]) invalid(`${ref} belongs to more than one Journey`);
      owners.set(ref, journey["@id"]);
    }
    for (const ref of entries) {
      const entry = node(index, ref, ["JourneyEntry"]);
      if (!states.includes(entry.stateRef as string)) invalid(`${ref}.stateRef must belong to ${journey["@id"]}.stateRefs`);
    }
    states.forEach((ref) => node(index, ref, ["State", "CompositeState"]));
    refs(journey.exitRefs).forEach((ref) => node(index, ref, ["JourneyExit"]));
    for (const ref of refs(journey.transitionRefs)) {
      const transition = node(index, ref, ["Transition", "AdjacentTransition"]);
      if (!states.includes(transition.from as string) || ![...states, ...refs(journey.exitRefs)].includes(transition.to as string)) invalid(`${ref}: transition endpoints must belong to ${journey["@id"]}`);
    }
  }
  for (const item of graph.nodes) {
    if (item.fromExitRef !== undefined || (has(item, "Transition") && item.toEntryRef !== undefined)) {
      for (const [property, endpoint, membership] of [["fromExitRef", "from", "exitRefs"], ["toEntryRef", "to", "entryRefs"]] as const) {
        if (item[property] === undefined) continue;
        const composite = node(index, item[endpoint], ["CompositeState"]);
        const children = refs(composite.subjourneyRefs).map((ref) => node(index, ref, ["Journey"]));
        if (children.filter((child) => refs(child[membership]).includes(item[property] as string)).length !== 1) invalid(`${item["@id"]}.${property} must belong to one referenced child Journey`);
      }
    }
    if (has(item, "OutgoingTransition") || has(item, "InvokingTransition")) {
      const candidateIds = item.toEntryRef === undefined
        ? refs(node(index, item.entrySelectorRef).candidateJourneyRefs)
        : [owners.get(item.toEntryRef as string) ?? invalid(`${item["@id"]}.toEntryRef has no owning Journey`)];
      for (const candidateId of candidateIds) {
        const candidate = node(index, candidateId, ["Journey"]);
        if (has(item, "InvokingTransition") && !refs(candidate.exitRefs).length) invalid(`${item["@id"]}: invoked Journeys must declare an exit`);
      }
    }
    if (has(item, "StateCollection")) {
      const member = node(index, item.memberStateRef, ["State", "CompositeState"]);
      if (!owners.has(member["@id"])) invalid(`${item["@id"]}: collection member has no owning Journey`);
      if (ofType("StateCollection").filter((collection) => collection.memberStateRef === member["@id"]).length !== 1) invalid(`${member["@id"]}: only one StateCollection is allowed`);
      for (const ref of refs(item.memberTransitionRefs)) {
        const transition = node(index, ref, ["Transition", "AdjacentTransition"]);
        if (transition.from !== member["@id"] || transition.to !== member["@id"] || ofType("Journey").some((journey) => refs(journey.transitionRefs).includes(ref))) invalid(`${ref}: member transitions must connect members and cannot appear in transitionRefs`);
      }
    }
    if (has(item, "AdjacentTransition") && item.from === item.to && !ofType("StateCollection").some((collection) => refs(collection.memberTransitionRefs).includes(item["@id"]))) invalid(`${item["@id"]}: a self adjacency must be a member transition`);
  }
  validateOperability(index, graph.nodes);
}

function validateSubjects(item: UjgNode): void {
  const supportedModules = new Set(["core", "graph", "surface", "l10n", "observability", "operability", "phase", "entry-binding", "effect", "artifact"]);
  for (const term of [...types(item), ...Object.keys(item).filter((key) => !key.startsWith("@") && key !== "extensions")]) {
    if (termModules[term] && !termModules[term].some((module) => supportedModules.has(module))) unsupported(`${item["@id"]}.${term}: module validation/lowering is not implemented`);
  }
  const subjects: Record<string, string[]> = {
    nodes: ["UJGDocument"], imports: ["UJGDocument"],
    defaultEntryRef: ["Journey"], entryRefs: ["Journey", "JourneyEntryIndex"], stateRef: ["JourneyEntry"],
    stateRefs: ["Journey"], transitionRefs: ["Journey"], exitRefs: ["Journey"], subjourneyRefs: ["CompositeState"],
    from: ["Transition", "AdjacentTransition"], to: ["Transition", "AdjacentTransition"],
    commandRef: ["Transition", "OutgoingTransition", "InvokingTransition"],
    fromExitRef: ["Transition"], toEntryRef: ["Transition", "OutgoingTransition", "InvokingTransition"],
    entryTransitionRefs: ["State"], entrySelectorRef: ["OutgoingTransition", "InvokingTransition"],
    candidateJourneyRefs: ["EntrySelector"], memberStateRef: ["StateCollection"], memberTransitionRefs: ["StateCollection"],
    graphNodeRef: ["Surface"], surfaceRef: ["SurfaceInstance"], touchpointRefs: ["Persona"], journeyRefs: ["Touchpoint"], channel: ["Touchpoint"],
    observeSurfaceRef: ["ObservationBinding"], observationEventRef: ["ObservationBinding"],
    requiredInputModalityProfileRefs: ["ObservationEvent"], inputModalityRefs: ["InputModalityProfile"],
    locatorRefs: ["ObservationBinding"], surfaceInstanceResolverRef: ["ObservationBinding"], expectedMatchCount: ["ObservationBinding"],
    instanceKeyFeatureRef: ["SurfaceInstanceResolver"], role: ["AccessibleLocator"], accessibleNameRef: ["AccessibleLocator"],
    accessibleDescriptionRef: ["AccessibleLocator"], accessibleFeatureRefs: ["AccessibleLocator"], accessibleRelationRefs: ["AccessibleLocator"],
    contextLocatorRefs: ["AccessibleLocator"], accessibleFeatureName: ["AccessibleFeature"], accessibleFeatureValue: ["AccessibleFeature"],
    accessibleRelationType: ["AccessibleRelation"], targetLocatorRef: ["AccessibleRelation"],
    compositeStateRef: ["Step"], phaseRef: ["Step"], order: ["Step", "Phase"], entryRef: ["EntryBinding"],
    value: ["EntryBinding", "Message"], localeCode: ["Locale"], rtl: ["Locale"], fallbackLocaleRefs: ["Locale"],
    defaultLocaleRef: ["MessageMeta"], argumentNames: ["MessageMeta"], messageMetaRef: ["Message"], localeRef: ["Message"],
    effectRef: ["Transition", "OutgoingTransition", "InvokingTransition"], producedRefs: ["Effect"], consumedRefs: ["Effect"],
    nameRef: ["Artifact"], sourceTouchpointRef: ["Artifact"], targetTouchpointRefs: ["Artifact"]
  };
  for (const [key, allowed] of Object.entries(subjects)) if (item[key] !== undefined && !allowed.some((type) => has(item, type))) invalid(`${item["@id"]}.${key} is on the wrong node type`);
}

function requireRefs(item: UjgNode, key: string): string[] {
  const value = refs(item[key]);
  if (!value.length) invalid(`${item["@id"]}.${key} must contain at least one reference`);
  return value;
}

/** Structural validity is independent of whether a materialization can be performed. */
export function validateOperability(index: Rc4Index, nodes: readonly UjgNode[]): void {
  const stepTypes = ["MoveStep", "ActivationStep", "ShortcutStep"];
  const materials = nodes.filter((item) => has(item, "TransitionMaterialization"));
  const stepOwners = new Map<string, string>();
  const subjects: Record<string, string[]> = {
    materializationTransitionRef: ["TransitionMaterialization"], materializationModalityRef: ["TransitionMaterialization"],
    materializationStepRefs: ["TransitionMaterialization"], materializationStartLocatorRef: ["TransitionMaterialization"],
    materializationSourceStateRef: ["TransitionMaterialization"], materializationDirectionRef: ["TransitionMaterialization"],
    stepPreviousRef: stepTypes, stepLocatorRef: stepTypes, stepMoveKindRef: ["MoveStep"]
  };
  for (const item of nodes) {
    for (const [property, allowed] of Object.entries(subjects)) if (item[property] !== undefined && !allowed.some((type) => has(item, type))) invalid(`${item["@id"]}.${property} is on the wrong node type`);
    if (stepTypes.filter((type) => has(item, type)).length > 1) invalid(`${item["@id"]}: materialization step types are exclusive`);
    if (has(item, "FocusMoveKind") && has(item, "MoveKind")) invalid(`${item["@id"]}: move kind types are exclusive`);
    if (has(item, "MaterializationDirection") && !["operability:forward", "operability:backward"].includes(item["@id"])) invalid(`${item["@id"]}: only forward and backward directions exist`);
    if (item.stepMoveKindRef !== undefined) node(index, item.stepMoveKindRef, ["FocusMoveKind", "MoveKind"]);
    if (item.stepLocatorRef !== undefined) node(index, item.stepLocatorRef, ["AccessibleLocator", "CustomLocator"]);
    if (item.stepPreviousRef !== undefined) node(index, item.stepPreviousRef, stepTypes);
  }
  for (const material of materials) {
    const id = material["@id"];
    const transition = node(index, material.materializationTransitionRef, ["Transition", "AdjacentTransition", "OutgoingTransition", "InvokingTransition"]);
    const modality = node(index, material.materializationModalityRef, ["InputModality"]);
    const steps = requireRefs(material, "materializationStepRefs");
    if (transition.fromExitRef !== undefined) invalid(`${id}: a transition with fromExitRef cannot be materialized`);
    const adjacent = has(transition, "AdjacentTransition");
    if (adjacent !== (material.materializationDirectionRef !== undefined)) invalid(`${id}: direction is required exactly for AdjacentTransition`);
    if (material.materializationDirectionRef !== undefined && !["operability:forward", "operability:backward"].includes(material.materializationDirectionRef as string)) invalid(`${id}: invalid materialization direction`);
    if (material.materializationStartLocatorRef !== undefined) node(index, material.materializationStartLocatorRef, ["AccessibleLocator", "CustomLocator"]);
    if (material.materializationSourceStateRef !== undefined) {
      const state = node(index, material.materializationSourceStateRef, ["State"]);
      const left = material.materializationDirectionRef === "operability:backward" ? transition.to : transition.from;
      const source = left === undefined ? undefined : node(index, left);
      if (!refs(state.entryTransitionRefs).includes(transition["@id"]) && !(source && has(source, "CompositeState") && nestedStates(index, source).has(state["@id"]))) invalid(`${id}: source State must offer the entry transition or be nested in its source CompositeState`);
    }
    for (const ref of steps) {
      const step = node(index, ref, stepTypes);
      if (stepOwners.has(ref)) invalid(`${ref}: materialization step belongs to more than one materialization`);
      stepOwners.set(ref, id);
      if (step.stepPreviousRef !== undefined && !steps.includes(step.stepPreviousRef as string)) invalid(`${id}: predecessor ${step.stepPreviousRef} is outside the materialization`);
      const kind = step.stepMoveKindRef === undefined ? undefined : node(index, step.stepMoveKindRef);
      if (modality["@id"] === "observability:pointer" && kind && has(kind, "FocusMoveKind")) invalid(`${id}: pointer materializations cannot use focus moves`);
      if (kind?.["@id"] === "operability:pointAt" && modality["@id"] !== "observability:pointer") invalid(`${id}: pointAt requires pointer modality`);
    }
    orderedSteps(index, material);
  }
  for (const item of nodes) if (stepTypes.some((type) => has(item, type)) && !stepOwners.has(item["@id"])) invalid(`${item["@id"]}: materialization step has no owning materialization`);
}

export function orderedSteps(index: Rc4Index, material: UjgNode): UjgNode[] {
  const steps = refs(material.materializationStepRefs).map((ref) => node(index, ref));
  const roots = steps.filter((item) => item.stepPreviousRef === undefined);
  if (roots.length !== 1) invalid(`${material["@id"]}: exactly one first step is required`);
  const successors = new Map<string, UjgNode>();
  for (const step of steps) if (step.stepPreviousRef !== undefined) {
    if (successors.has(step.stepPreviousRef as string)) invalid(`${material["@id"]}: two steps follow the same predecessor`);
    successors.set(step.stepPreviousRef as string, step);
  }
  const result: UjgNode[] = [], seen = new Set<string>();
  let current: UjgNode | undefined = roots[0];
  while (current) {
    if (seen.has(current["@id"])) invalid(`${material["@id"]}: cyclic step chain`);
    seen.add(current["@id"]); result.push(current); current = successors.get(current["@id"]);
  }
  if (result.length !== steps.length) invalid(`${material["@id"]}: disconnected or cyclic step chain`);
  return result;
}

function nestedStates(index: Rc4Index, composite: UjgNode, seen = new Set<string>()): Set<string> {
  if (seen.has(composite["@id"])) return new Set();
  seen.add(composite["@id"]);
  const result = new Set<string>();
  for (const ref of refs(composite.subjourneyRefs)) for (const stateRef of refs(node(index, ref).stateRefs)) {
    const state = node(index, stateRef); result.add(stateRef);
    if (has(state, "CompositeState")) nestedStates(index, state, seen).forEach((id) => result.add(id));
  }
  return result;
}
