// Frozen RC4 context term mappings. Sources: https://ujg.specs.openuji.org/tr/1.0-rc4/ns/*.context.jsonld
// No remote context is fetched while compiling a document.
import { invalid, unsupported, types, type UjgDocument, type UjgNode } from "../../document.js";
export const specVersion = "1.0-rc4";
export const contextRoot = "https://ujg.specs.openuji.org/tr/1.0-rc4/ns/";
export const termModules: Readonly<Record<string, readonly string[]>> = {
  "PainPoint": [
    "experience-annotation"
  ],
  "painpointStepRefs": [
    "experience-annotation"
  ],
  "severity": [
    "experience-annotation"
  ],
  "description": [
    "experience-annotation"
  ],
  "JourneyExecution": [
    "runtime"
  ],
  "RuntimeEvent": [
    "runtime"
  ],
  "executionId": [
    "runtime"
  ],
  "previousId": [
    "runtime"
  ],
  "surfaceInstanceRef": [
    "runtime"
  ],
  "payload": [
    "runtime"
  ],
  "surface": [
    "surface",
    "design-system"
  ],
  "Surface": [
    "surface"
  ],
  "SurfaceInstance": [
    "surface"
  ],
  "Touchpoint": [
    "surface"
  ],
  "Persona": [
    "surface"
  ],
  "graphNodeRef": [
    "surface"
  ],
  "surfaceRef": [
    "surface"
  ],
  "touchpointRefs": [
    "surface"
  ],
  "journeyRefs": [
    "surface"
  ],
  "channel": [
    "surface"
  ],
  "Condition": [
    "condition"
  ],
  "ConditionalTransitionSet": [
    "condition"
  ],
  "conditionRef": [
    "condition"
  ],
  "conditionTransitionRefs": [
    "condition"
  ],
  "Locale": [
    "l10n"
  ],
  "MessageMeta": [
    "l10n"
  ],
  "Message": [
    "l10n"
  ],
  "copyRef": [
    "l10n"
  ],
  "localeCode": [
    "l10n"
  ],
  "argumentNames": [
    "l10n"
  ],
  "defaultLocaleRef": [
    "l10n"
  ],
  "fallbackLocaleRefs": [
    "l10n"
  ],
  "rtl": [
    "l10n"
  ],
  "messageMetaRef": [
    "l10n"
  ],
  "localeRef": [
    "l10n"
  ],
  "value": [
    "l10n",
    "entry-binding"
  ],
  "targetLocaleRef": [
    "l10n"
  ],
  "ObservationBinding": [
    "observability"
  ],
  "ObservationEvent": [
    "observability"
  ],
  "InputModality": [
    "observability"
  ],
  "InputModalityProfile": [
    "observability"
  ],
  "AccessibleLocator": [
    "observability"
  ],
  "AccessibleFeature": [
    "observability"
  ],
  "AccessibleRelation": [
    "observability"
  ],
  "CustomLocator": [
    "observability"
  ],
  "SurfaceInstanceResolver": [
    "observability"
  ],
  "keyboard": [
    "observability"
  ],
  "pointer": [
    "observability"
  ],
  "observeSurfaceRef": [
    "observability"
  ],
  "observationEventRef": [
    "observability"
  ],
  "requiredInputModalityProfileRefs": [
    "observability"
  ],
  "inputModalityRefs": [
    "observability"
  ],
  "locatorRefs": [
    "observability"
  ],
  "surfaceInstanceResolverRef": [
    "observability"
  ],
  "expectedMatchCount": [
    "observability"
  ],
  "instanceKeyFeatureRef": [
    "observability"
  ],
  "role": [
    "observability"
  ],
  "accessibleNameRef": [
    "observability"
  ],
  "accessibleDescriptionRef": [
    "observability"
  ],
  "accessibleFeatureRefs": [
    "observability"
  ],
  "accessibleRelationRefs": [
    "observability"
  ],
  "contextLocatorRefs": [
    "observability"
  ],
  "accessibleFeatureName": [
    "observability"
  ],
  "accessibleFeatureValue": [
    "observability"
  ],
  "accessibleRelationType": [
    "observability"
  ],
  "targetLocatorRef": [
    "observability"
  ],
  "mapping": [
    "mapping"
  ],
  "JourneyMapping": [
    "mapping"
  ],
  "MappedStep": [
    "mapping"
  ],
  "mappedJourneyRef": [
    "mapping"
  ],
  "mappedRuntimeRef": [
    "mapping"
  ],
  "mappedStepRef": [
    "mapping"
  ],
  "mappedEventRef": [
    "mapping"
  ],
  "observedAffordanceEventRef": [
    "mapping"
  ],
  "mappedStateRef": [
    "mapping"
  ],
  "explainedByTransitionRef": [
    "mapping"
  ],
  "imports": [
    "core"
  ],
  "nodes": [
    "core"
  ],
  "extensions": [
    "core"
  ],
  "Journey": [
    "graph"
  ],
  "JourneyEntry": [
    "graph"
  ],
  "JourneyEntryIndex": [
    "graph"
  ],
  "State": [
    "graph"
  ],
  "CompositeState": [
    "graph"
  ],
  "Transition": [
    "graph"
  ],
  "AdjacentTransition": [
    "graph"
  ],
  "Command": [
    "graph"
  ],
  "JourneyExit": [
    "graph"
  ],
  "OutgoingTransition": [
    "graph"
  ],
  "InvokingTransition": [
    "graph"
  ],
  "StateCollection": [
    "graph"
  ],
  "EntrySelector": [
    "graph"
  ],
  "label": [
    "graph"
  ],
  "tags": [
    "graph"
  ],
  "defaultEntryRef": [
    "graph"
  ],
  "entryRefs": [
    "graph"
  ],
  "stateRef": [
    "graph"
  ],
  "stateRefs": [
    "graph"
  ],
  "transitionRefs": [
    "graph"
  ],
  "exitRefs": [
    "graph"
  ],
  "from": [
    "graph"
  ],
  "to": [
    "graph"
  ],
  "fromExitRef": [
    "graph"
  ],
  "toEntryRef": [
    "graph"
  ],
  "commandRef": [
    "graph"
  ],
  "subjourneyRefs": [
    "graph"
  ],
  "entryTransitionRefs": [
    "graph"
  ],
  "memberStateRef": [
    "graph"
  ],
  "memberTransitionRefs": [
    "graph"
  ],
  "entrySelectorRef": [
    "graph"
  ],
  "candidateJourneyRefs": [
    "graph"
  ],
  "dataContract": [
    "data-contract"
  ],
  "DataSchema": [
    "data-contract"
  ],
  "DataBinding": [
    "data-contract"
  ],
  "dataSchemaSource": [
    "data-contract"
  ],
  "dataSurfaceRef": [
    "data-contract"
  ],
  "dataSchemaRef": [
    "data-contract"
  ],
  "Effect": [
    "effect"
  ],
  "EffectResource": [
    "effect"
  ],
  "effectRef": [
    "effect"
  ],
  "producedRefs": [
    "effect"
  ],
  "consumedRefs": [
    "effect"
  ],
  "EntryBinding": [
    "entry-binding"
  ],
  "entryRef": [
    "entry-binding"
  ],
  "designSystem": [
    "design-system"
  ],
  "Theme": [
    "design-system"
  ],
  "TokenSource": [
    "design-system"
  ],
  "Component": [
    "design-system"
  ],
  "Template": [
    "design-system"
  ],
  "Slot": [
    "design-system"
  ],
  "SurfaceMaterialization": [
    "design-system"
  ],
  "SlotBinding": [
    "design-system"
  ],
  "tokenSourceRefs": [
    "design-system"
  ],
  "source": [
    "design-system"
  ],
  "componentRef": [
    "design-system"
  ],
  "templateRef": [
    "design-system"
  ],
  "slotBindingRefs": [
    "design-system"
  ],
  "slotRefs": [
    "design-system"
  ],
  "slotRef": [
    "design-system"
  ],
  "targetSurfaceRef": [
    "design-system"
  ],
  "TransitionMaterialization": [
    "operability"
  ],
  "MoveStep": [
    "operability"
  ],
  "ActivationStep": [
    "operability"
  ],
  "ShortcutStep": [
    "operability"
  ],
  "FocusMoveKind": [
    "operability"
  ],
  "MoveKind": [
    "operability"
  ],
  "MaterializationDirection": [
    "operability"
  ],
  "materializationTransitionRef": [
    "operability"
  ],
  "materializationModalityRef": [
    "operability"
  ],
  "materializationStepRefs": [
    "operability"
  ],
  "materializationStartLocatorRef": [
    "operability"
  ],
  "materializationSourceStateRef": [
    "operability"
  ],
  "materializationDirectionRef": [
    "operability"
  ],
  "stepPreviousRef": [
    "operability"
  ],
  "stepLocatorRef": [
    "operability"
  ],
  "stepMoveKindRef": [
    "operability"
  ],
  "Phase": [
    "phase"
  ],
  "Step": [
    "phase"
  ],
  "compositeStateRef": [
    "phase"
  ],
  "phaseRef": [
    "phase"
  ],
  "order": [
    "phase"
  ],
  "Artifact": [
    "artifact"
  ],
  "nameRef": [
    "artifact"
  ],
  "sourceTouchpointRef": [
    "artifact"
  ],
  "targetTouchpointRefs": [
    "artifact"
  ],
  "UJGDocument": [
    "core"
  ],
  "Node": [
    "core"
  ]
};
export const classNames = new Set(["AccessibleFeature", "AccessibleLocator", "AccessibleRelation", "ActivationStep", "AdjacentTransition", "Artifact", "Command", "Component", "CompositeState", "Condition", "ConditionalTransitionSet", "CustomLocator", "DataBinding", "DataSchema", "Effect", "EffectResource", "EntryBinding", "EntrySelector", "FocusMoveKind", "InputModality", "InputModalityProfile", "InvokingTransition", "Journey", "JourneyEntry", "JourneyEntryIndex", "JourneyExecution", "JourneyExit", "JourneyMapping", "Locale", "MappedStep", "MaterializationDirection", "Message", "MessageMeta", "MoveKind", "MoveStep", "Node", "ObservationBinding", "ObservationEvent", "OutgoingTransition", "PainPoint", "Persona", "Phase", "RuntimeEvent", "ShortcutStep", "Slot", "SlotBinding", "State", "StateCollection", "Step", "Surface", "SurfaceInstance", "SurfaceInstanceResolver", "SurfaceMaterialization", "Template", "Theme", "TokenSource", "Touchpoint", "Transition", "TransitionMaterialization", "UJGDocument"]);
export const setProperties = new Set(["accessibleFeatureRefs", "accessibleRelationRefs", "argumentNames", "candidateJourneyRefs", "conditionTransitionRefs", "consumedRefs", "contextLocatorRefs", "entryRefs", "entryTransitionRefs", "exitRefs", "fallbackLocaleRefs", "imports", "inputModalityRefs", "journeyRefs", "locatorRefs", "mappedStepRef", "materializationStepRefs", "memberTransitionRefs", "nodes", "painpointStepRefs", "producedRefs", "requiredInputModalityProfileRefs", "slotBindingRefs", "slotRefs", "stateRefs", "subjourneyRefs", "tags", "targetTouchpointRefs", "tokenSourceRefs", "touchpointRefs", "transitionRefs"]);
export const referenceProperties = new Set(["accessibleDescriptionRef", "accessibleFeatureRefs", "accessibleNameRef", "accessibleRelationRefs", "candidateJourneyRefs", "commandRef", "componentRef", "compositeStateRef", "conditionRef", "conditionTransitionRefs", "consumedRefs", "contextLocatorRefs", "copyRef", "dataSchemaRef", "dataSchemaSource", "dataSurfaceRef", "defaultEntryRef", "defaultLocaleRef", "effectRef", "entryRef", "entryRefs", "entrySelectorRef", "entryTransitionRefs", "executionId", "exitRefs", "explainedByTransitionRef", "fallbackLocaleRefs", "from", "fromExitRef", "graphNodeRef", "imports", "inputModalityRefs", "instanceKeyFeatureRef", "journeyRefs", "localeRef", "locatorRefs", "mappedEventRef", "mappedJourneyRef", "mappedRuntimeRef", "mappedStateRef", "mappedStepRef", "materializationDirectionRef", "materializationModalityRef", "materializationSourceStateRef", "materializationStartLocatorRef", "materializationStepRefs", "materializationTransitionRef", "memberStateRef", "memberTransitionRefs", "messageMetaRef", "nameRef", "observationEventRef", "observeSurfaceRef", "observedAffordanceEventRef", "painpointStepRefs", "phaseRef", "previousId", "producedRefs", "requiredInputModalityProfileRefs", "slotBindingRefs", "slotRef", "slotRefs", "source", "sourceTouchpointRef", "stateRef", "stateRefs", "stepLocatorRef", "stepMoveKindRef", "stepPreviousRef", "subjourneyRefs", "surfaceInstanceRef", "surfaceInstanceResolverRef", "surfaceRef", "targetLocaleRef", "targetLocatorRef", "targetSurfaceRef", "targetTouchpointRefs", "templateRef", "to", "toEntryRef", "tokenSourceRefs", "touchpointRefs", "transitionRefs"]);

export const standardNodes: readonly UjgNode[] = [
  { "@id": "observability:keyboard", "@type": "InputModality" },
  { "@id": "observability:pointer", "@type": "InputModality" },
  ...["nextStop", "previousStop", "nextItem", "previousItem", "firstItem", "lastItem"].map((name) => ({ "@id": `operability:${name}`, "@type": "FocusMoveKind" })),
  ...["pointAt", "nextPage", "previousPage"].map((name) => ({ "@id": `operability:${name}`, "@type": "MoveKind" })),
  ...["forward", "backward"].map((name) => ({ "@id": `operability:${name}`, "@type": "MaterializationDirection" }))
];
export function compactStandard(value: string): string {
  for (const node of standardNodes) {
    const [module, name] = node["@id"].split(":");
    if (value === `${contextRoot}${module}#${name}`) return node["@id"];
  }
  return value;
}

export function parseRc4Document(input: unknown): UjgDocument {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("UJG document must be an object");
  const document = structuredClone(input) as UjgDocument;
  const contexts = typeof document["@context"] === "string" ? [document["@context"]] : document["@context"];
  if (!Array.isArray(contexts) || !contexts.length || contexts.some((url) => typeof url !== "string")) unsupported("Canonical compact @context URLs are required");
  const modules = new Set<string>();
  for (const url of contexts) {
    if (url === `${contextRoot}context.jsonld`) { ["core", "graph", "surface", "runtime"].forEach((module) => modules.add(module)); continue; }
    const module = url.startsWith(contextRoot) ? url.slice(contextRoot.length).replace(/\.context\.jsonld$/, "") : "";
    if (url !== `${contextRoot}${module}.context.jsonld` || !Object.values(termModules).some((values) => values.includes(module))) unsupported(`Unknown RC4 context ${url}`);
    modules.add(module);
  }
  if (!modules.has("core")) invalid("Core context is required");
  checkIdentity(document, "document");
  if (!types(document).includes("UJGDocument")) invalid(`${document["@id"]} must have @type UJGDocument`);
  for (const key of Object.keys(document)) if (!["@context", "@id", "@type", "nodes", "imports", "extensions"].includes(key)) unsupported(`Unsupported document property ${key}`);
  checkExtensions(document.extensions, document["@id"]);
  if (document.imports !== undefined && (!Array.isArray(document.imports) || document.imports.some((ref) => typeof ref !== "string" || !ref.length || /\s/.test(ref)))) invalid(`${document["@id"]}.imports must contain IRI references`);
  if (document.nodes !== undefined && !Array.isArray(document.nodes)) invalid(`${document["@id"]}.nodes must be an array`);
  const ids = new Set<string>();
  for (const node of document.nodes ?? []) {
    if (!node || typeof node !== "object" || Array.isArray(node)) invalid("Each node must be an object");
    node["@id"] = typeof node["@id"] === "string" ? compactStandard(node["@id"]) : node["@id"];
    checkIdentity(node, "node");
    if (Array.isArray(node["@type"])) node["@type"] = [...new Set(node["@type"])].sort();
    if (ids.has(node["@id"])) invalid(`Duplicate UJG node id ${node["@id"]}`);
    ids.add(node["@id"]);
    checkExtensions(node.extensions, node["@id"]);
    for (const type of types(node)) {
      if (!classNames.has(type)) unsupported(`${node["@id"]}: unsupported compact class ${type}`);
      requireContext(type, modules, node["@id"]);
    }
    for (const [key, value] of Object.entries(node)) {
      if (["@id", "@type", "extensions"].includes(key)) continue;
      if (!termModules[key] || classNames.has(key) || ["keyboard", "pointer", "annotation"].includes(key)) unsupported(`${node["@id"]}: unsupported property ${key}`);
      requireContext(key, modules, node["@id"]);
      if (setProperties.has(key)) {
        if (!Array.isArray(value)) invalid(`${node["@id"]}.${key} must be an array`);
        if (referenceProperties.has(key) && value.some((ref) => typeof ref !== "string")) invalid(`${node["@id"]}.${key} must contain IRI references`);
        node[key] = [...new Set(value.map((entry) => typeof entry === "string" && referenceProperties.has(key) ? compactStandard(entry) : entry))].sort();
      } else if (referenceProperties.has(key)) {
        if (typeof value !== "string") invalid(`${node["@id"]}.${key} must be one IRI reference`);
        node[key] = compactStandard(value);
      }
    }
  }
  return document;
}
function checkIdentity(value: Pick<UjgNode, "@id" | "@type">, name: string): void {
  if (typeof value["@id"] !== "string" || !/^[a-z][a-z\d+.-]*:[^\s]+$/i.test(value["@id"])) invalid(`${name} must have an absolute IRI @id`);
  if (!(typeof value["@type"] === "string" && value["@type"].length) && !(Array.isArray(value["@type"]) && value["@type"].length && value["@type"].every((type) => typeof type === "string"))) invalid(`${value["@id"]} must declare @type`);
}
function requireContext(term: string, modules: Set<string>, id: string): void {
  if (!termModules[term].some((module) => modules.has(module))) invalid(`${id}.${term} requires its RC4 ${termModules[term].join(" or ")} context`);
}
function checkExtensions(value: unknown, id: string): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${id}.extensions must be an object`);
  for (const [key, item] of Object.entries(value)) {
    if (!/[.:]/.test(key) || !item || typeof item !== "object" || Array.isArray(item)) invalid(`${id}.extensions.${key} must be a namespaced object`);
  }
}
