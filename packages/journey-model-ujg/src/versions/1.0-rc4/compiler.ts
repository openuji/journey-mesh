import { invalid, unsupported, type UjgDocument, type UjgNode, type ResolvedUjgDocumentGraph, type CompileUjgJourneyPlanOptions } from "../../document.js";
import { indexGraph, orderedSteps } from "./validation.js";

import type {
  AccessibleFeature,
  ControlFlowPlanOperation,
  EntryBindingRef,
  GraphVertexRef,
  JourneyEntryRef,
  JourneyPlan,
  JourneyPlanOperation,
  LabeledRef,
  ResolvedAccessibleLocator,
  ResolvedArtifact,
  ResolvedEffect,
  ResolvedInputModality,
  ResolvedInputModalityProfile,
  ResolvedObservationBinding,
  ResolvedStateObservation,
  ResolvedStateObservationTarget,
  ResolvedSurfaceInstanceResolver,
  ResolvedTransitionActivation,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";
import { immutableJourneyPlan } from "@openuji/journey-execution-model";

type AnyNode = UjgNode & Record<string, unknown>;

type NodeIndex = {
  byId: Map<string, AnyNode>;
  sourceOrder: Map<string, number>;
};

type CompositeAssignment = {
  personaId: string;
  touchpointId: string;
};

type CompositeContext = {
  composite: AnyNode;
  journey: AnyNode;
  entry: AnyNode;
  entryBinding?: EntryBindingRef;
};

type PathItem =
  | { kind: "state"; node: AnyNode }
  | { kind: "transition"; node: AnyNode }
  | { kind: "control-flow"; node: AnyNode; fromExit: AnyNode; toEntry?: AnyNode };

const stateObservationEventIds = new Set([
  "urn:observation-event:presence",
  "urn:observation-event:absence"
]);

export function compileRc4JourneyPlan(graph: ResolvedUjgDocumentGraph, options: CompileUjgJourneyPlanOptions = {}): JourneyPlan {
  const document = { ...graph.root, nodes: [...graph.nodes] };
  const index = indexDocument(document);
  for (const [id, node] of indexGraph(graph)) if (!index.byId.has(id)) index.byId.set(id, node);
  assertSupportedSelection(index, options.journeyId);
  const selectedComposites = options.journeyId ? journeyComposites(index, options.journeyId) : undefined;
  const assignmentByComposite = buildCompositeAssignments(index, selectedComposites);
  const parentByComposite = buildParentCompositeMap(index, selectedComposites);
  const phases = nodesOfType(index, "Phase");
  const steps = nodesOfType(index, "Step");
  const phaseById = new Map(phases.map((phase) => [phase["@id"], phase]));
  const operations: JourneyPlanOperation[] = [];
  const selectedSteps = selectedComposites
    ? steps.filter((step) => selectedComposites.has(requiredString(step.compositeStateRef, `${step["@id"]}.compositeStateRef`)))
    : steps;
  if (selectedSteps.length === 0) {
    unsupported(`Journey ${options.journeyId} has no executable steps`);
  }

  for (const step of sortedSteps(index, selectedSteps, phaseById)) {
    const compositeStateId = requiredString(
      step.compositeStateRef,
      `${step["@id"]}.compositeStateRef`
    );
    const assignment = assignmentByComposite.get(compositeStateId);
    if (!assignment) {
      unsupported(`No persona/touchpoint assignment for ${compositeStateId}`);
    }

    const phaseId = requiredString(step.phaseRef, `${step["@id"]}.phaseRef`);
    requireNode(index, phaseId, "Phase");
    const compositeContext = compositeContextFor(index, compositeStateId);
    const path = buildStepPath(index, compositeStateId, parentByComposite, selectedComposites);

    for (const pathItem of path) {
      operations.push(
        operationForPathItem({
          assignment,
          compositeContext,
          document,
          index,
          pathItem,
          phaseId,
          sequence: operations.length,
          step
        })
      );
    }
  }

  return immutableJourneyPlan({
    id: `${document["@id"]}:plan:ujg-1.0-rc4${options.journeyId ? `:${options.journeyId}` : ""}`,
    source: {
      model: "ujg",
      documentId: document["@id"],
      references: { specVersion: "1.0-rc4", compilerId: "ujg:1.0-rc4", ...(options.journeyId ? { journeyId: options.journeyId } : {}) }
    },
    operations: operations.map((operation) => ({ ...operation, source: { references: { ...operation.source?.references, specVersion: "1.0-rc4", compilerId: "ujg:1.0-rc4", sourceDocumentIds: graph.nodeSources[operation.source?.references?.graphNodeId as string] ?? [] } } }))
  });
}

function operationForPathItem({
  assignment,
  compositeContext,
  document,
  index,
  pathItem,
  phaseId,
  sequence,
  step
}: {
  assignment: CompositeAssignment;
  compositeContext: CompositeContext;
  document: UjgDocument;
  index: NodeIndex;
  pathItem: PathItem;
  phaseId: string;
  sequence: number;
  step: AnyNode;
}): JourneyPlanOperation {
  const base = {
    id: operationId(document["@id"], sequence, pathItem.node["@id"]),
    sequence,
    actorId: assignment.personaId,
    touchpointId: assignment.touchpointId,
    entry: entryRef(compositeContext.entry),
    source: {
      references: {
        phaseId,
        stepId: step["@id"],
        graphNodeId: pathItem.node["@id"]
      }
    },
    ...(compositeContext.entryBinding ? { entryBinding: compositeContext.entryBinding } : {})
  };

  if (pathItem.kind === "state") {
    return {
      ...base,
      kind: "state",
      state: labeledRef(pathItem.node),
      surface: surfaceRef(requireSingleSurfaceForGraphNode(index, pathItem.node["@id"])),
      target: resolveStateObservationTarget(index, pathItem.node["@id"])
    } satisfies StatePlanOperation;
  }

  if (pathItem.kind === "transition") {
    const transition = pathItem.node;
    const activation = resolveTransitionActivation(index, transition["@id"]);
    const effects = resolveTransitionEffects(index, transition);

    return {
      ...base,
      kind: "transition",
      transition: transitionRef(transition),
      from: activation.from,
      to: activation.to,
      surface: surfaceRef(requireSingleSurfaceForGraphNode(index, requiredString(transition.commandRef, `${transition["@id"]}.commandRef`))),
      activation,
      materializations: resolveMaterializations(index, transition["@id"]),
      effects
    } satisfies TransitionPlanOperation;
  }

  return {
    ...base,
    kind: "control-flow",
    transition: controlFlowTransitionRef(pathItem.node),
    fromExit: labeledRef(pathItem.fromExit),
    ...(pathItem.toEntry ? { toEntry: entryRef(pathItem.toEntry) } : {})
  } satisfies ControlFlowPlanOperation;
}

function buildStepPath(
  index: NodeIndex,
  compositeStateId: string,
  parentByComposite: Map<string, string>,
  selectedComposites?: ReadonlySet<string>
): PathItem[] {
  const context = compositeContextFor(index, compositeStateId);
  const transitionRefs = requiredStringArray(
    context.journey.transitionRefs ?? [],
    `${context.journey["@id"]}.transitionRefs`
  );
  const entryState = index.byId.get(context.entry.stateRef as string);
  if (entryState && hasType(entryState, "CompositeState")) unsupported(`${context.entry["@id"]}: linear step lowering requires a State entry`);
  const transitions = transitionRefs.map((ref) => requireNode(index, ref, "Transition"));
  let current = requireNode(
    index,
    requiredString(context.entry.stateRef, `${context.entry["@id"]}.stateRef`),
    "State"
  );
  const path: PathItem[] = [];
  const visitedStates = new Set<string>();

  while (true) {
    if (visitedStates.has(current["@id"])) {
      unsupported(`Cycle detected while compiling ${compositeStateId} at ${current["@id"]}`);
    }
    visitedStates.add(current["@id"]);
    path.push({ kind: "state", node: current });

    const nextTransitions = transitions.filter((transition) => transition.from === current["@id"]);
    if (nextTransitions.length === 0) return path;
    if (nextTransitions.length > 1) {
      unsupported(
        `Ambiguous transition branch from ${current["@id"]} in ${context.journey["@id"]}`
      );
    }

    const transition = nextTransitions[0];
    path.push({ kind: "transition", node: transition });

    const toId = requiredString(transition.to, `${transition["@id"]}.to`);
    const toNode = requireLocalVertex(index, toId);

    if (hasType(toNode, "State")) {
      current = toNode;
      continue;
    }

    if (hasType(toNode, "JourneyExit")) {
      const continuation = parentContinuationForExit({
        childCompositeId: compositeStateId,
        exitId: toNode["@id"],
        index,
        parentByComposite,
        selectedComposites
      });

      if (continuation) {
        path.push({
          kind: "control-flow",
          node: continuation.transition,
          fromExit: toNode,
          toEntry: continuation.toEntry
        });
      }

      return path;
    }

    unsupported(
      `Transition ${transition["@id"]} targets ${toId}; v1 step compilation supports State or JourneyExit targets`
    );
  }
}

function parentContinuationForExit({
  childCompositeId,
  exitId,
  index,
  parentByComposite,
  selectedComposites
}: {
  childCompositeId: string;
  exitId: string;
  index: NodeIndex;
  parentByComposite: Map<string, string>;
  selectedComposites?: ReadonlySet<string>;
}): { transition: AnyNode; toEntry?: AnyNode } | undefined {
  const parentCompositeId = parentByComposite.get(childCompositeId);
  if (!parentCompositeId || (selectedComposites && !selectedComposites.has(parentCompositeId))) return undefined;

  const parentContext = compositeContextFor(index, parentCompositeId);
  const transitionRefs = optionalStringArray(parentContext.journey.transitionRefs);
  const transitions = transitionRefs
    .map((ref) => requireNode(index, ref, "Transition"))
    .filter(
      (transition) => transition.from === childCompositeId && transition.fromExitRef === exitId
    );

  if (transitions.length > 1) {
    invalid(`Ambiguous parent continuation for ${childCompositeId} exit ${exitId}`);
  }
  if (transitions.length === 0) return undefined;

  const transition = transitions[0];
  const toEntryRef = optionalString(transition.toEntryRef);
  const toEntry = toEntryRef ? requireNode(index, toEntryRef, "JourneyEntry") : undefined;

  return { transition, toEntry };
}

function resolveStateObservationTarget(
  index: NodeIndex,
  stateId: string
): ResolvedStateObservationTarget {
  const observation = resolveStateObservation(index, stateId);

  return {
    observation,
    expectedMatchCount: observation.expectedMatchCount,
    bindings: observation.bindings
  };
}

function resolveStateObservation(index: NodeIndex, stateId: string): ResolvedStateObservation {
  const state = requireNode(index, stateId, "State");
  const surface = requireSingleSurfaceForGraphNode(index, stateId);
  const bindings = observationBindingsForSurface(index, surface["@id"])
    .filter((binding) => isStateObservationBinding(index, binding))
    .map((binding) => resolveObservationBinding(index, binding));

  if (bindings.length === 0) {
    unsupported(`No state ObservationBinding found for surface ${surface["@id"]}`);
  }
  if (bindings.length !== 1) {
    unsupported(
      `Expected one state ObservationBinding for surface ${surface["@id"]}, found ${bindings.length}`
    );
  }
  if (bindings[0].expectedMatchCount === undefined) {
    unsupported(`State ObservationBinding ${bindings[0].id} must declare expectedMatchCount`);
  }

  return {
    stateId: state["@id"],
    stateLabel: optionalString(state.label),
    surfaceId: surface["@id"],
    surfaceLabel: optionalString(surface.label),
    expectedMatchCount: bindings[0].expectedMatchCount,
    bindings
  };
}

function resolveTransitionActivation(
  index: NodeIndex,
  transitionId: string
): ResolvedTransitionActivation {
  const transition = requireNode(index, transitionId, "Transition");
  const surface = requireSingleSurfaceForGraphNode(index, requiredString(transition.commandRef, `${transitionId}.commandRef`));
  const eventId = requireSingleActivationEventId(index, surface["@id"]);
  const event = requireNode(index, eventId, "ObservationEvent");
  const from = graphVertexRef(
    requireNode(index, requiredString(transition.from, `${transitionId}.from`), "State")
  );
  const to = graphVertexRef(
    requireLocalVertex(index, requiredString(transition.to, `${transitionId}.to`))
  );
  const bindings = observationBindingsForSurface(index, surface["@id"])
    .filter((binding) => binding.observationEventRef === eventId)
    .map((binding) => resolveObservationBinding(index, binding));

  if (bindings.length === 0) {
    invalid(`No ${eventId} ObservationBinding found for surface ${surface["@id"]}`);
  }

  return {
    transitionId: transition["@id"],
    transitionLabel: optionalString(transition.label),
    eventId: event["@id"],
    eventLabel: optionalString(event.label),
    from,
    to,
    effectRef: optionalString(transition.effectRef),
    surfaceId: surface["@id"],
    surfaceLabel: optionalString(surface.label),
    requiredInputModalityProfiles: resolveRequiredInputModalityProfiles(index, event),
    bindings
  };
}

function resolveObservationBinding(index: NodeIndex, binding: AnyNode): ResolvedObservationBinding {
  const eventId = requiredString(
    binding.observationEventRef,
    `${binding["@id"]}.observationEventRef`
  );
  const event = requireNode(index, eventId, "ObservationEvent");
  const locatorRefs = requiredStringArray(binding.locatorRefs, `${binding["@id"]}.locatorRefs`);

  return {
    id: binding["@id"],
    label: optionalString(binding.label),
    surfaceId: requiredString(binding.observeSurfaceRef, `${binding["@id"]}.observeSurfaceRef`),
    eventId,
    eventLabel: optionalString(event.label),
    expectedMatchCount: optionalExpectedMatchCount(
      binding.expectedMatchCount,
      `${binding["@id"]}.expectedMatchCount`
    ),
    requiredInputModalityProfiles: resolveRequiredInputModalityProfiles(index, event),
    locators: locatorRefs.map((locatorRef) => resolveAccessibleLocator(index, locatorRef)),
    surfaceInstanceResolver: resolveSurfaceInstanceResolver(index, binding.surfaceInstanceResolverRef)
  };
}

function resolveAccessibleLocator(
  index: NodeIndex,
  locatorId: string,
  seen: string[] = []
): ResolvedAccessibleLocator {
  if (seen.includes(locatorId)) {
    invalid(`Cycle detected in AccessibleLocator context chain: ${[...seen, locatorId].join(" -> ")}`);
  }

  const candidate = index.byId.get(locatorId);
  if (candidate && hasType(candidate, "CustomLocator")) {
    if (!candidate.extensions || typeof candidate.extensions !== "object" || Array.isArray(candidate.extensions)) unsupported(`CustomLocator ${locatorId} must declare extensions`);
    return { id: locatorId, label: optionalString(candidate.label), extensions: candidate.extensions as Record<string, unknown>, features: [], contexts: [] };
  }
  const locator = requireNode(index, locatorId, "AccessibleLocator");
  if (locator.accessibleRelationRefs !== undefined) unsupported(`AccessibleLocator ${locatorId}: relation lowering is not implemented`);
  const featureRefs = optionalStringArray(locator.accessibleFeatureRefs);
  const contextRefs = optionalStringArray(locator.contextLocatorRefs);

  return {
    id: locator["@id"],
    label: optionalString(locator.label),
    role: optionalString(locator.role),
    accessibleName: resolveMessage(index, locator.accessibleNameRef),
    accessibleDescription: resolveMessage(index, locator.accessibleDescriptionRef),
    features: featureRefs.map((featureRef) => resolveAccessibleFeature(index, featureRef)),
    contexts: contextRefs.map((contextRef) =>
      resolveAccessibleLocator(index, contextRef, [...seen, locatorId])
    )
  };
}

function resolveSurfaceInstanceResolver(
  index: NodeIndex,
  resolverRef: unknown
): ResolvedSurfaceInstanceResolver | undefined {
  if (resolverRef === undefined) return undefined;

  const resolverId = requiredString(resolverRef, "surfaceInstanceResolverRef");
  const resolver = requireNode(index, resolverId, "SurfaceInstanceResolver");
  const featureRef = requiredString(
    resolver.instanceKeyFeatureRef,
    `${resolverId}.instanceKeyFeatureRef`
  );

  return {
    id: resolver["@id"],
    label: optionalString(resolver.label),
    instanceKeyFeature: resolveAccessibleFeature(index, featureRef)
  };
}

function resolveAccessibleFeature(index: NodeIndex, featureId: string): AccessibleFeature {
  const feature = requireNode(index, featureId, "AccessibleFeature");

  return {
    id: feature["@id"],
    label: optionalString(feature.label),
    name: requiredString(feature.accessibleFeatureName, `${featureId}.accessibleFeatureName`),
    value: requiredString(feature.accessibleFeatureValue, `${featureId}.accessibleFeatureValue`)
  };
}

function resolveRequiredInputModalityProfiles(
  index: NodeIndex,
  event: AnyNode
): ResolvedInputModalityProfile[] {
  return optionalStringArray(event.requiredInputModalityProfileRefs).map((profileRef) =>
    resolveInputModalityProfile(index, profileRef)
  );
}

function resolveInputModalityProfile(
  index: NodeIndex,
  profileId: string
): ResolvedInputModalityProfile {
  const profile = requireNode(index, profileId, "InputModalityProfile");
  const modalityRefs = requiredStringArray(
    profile.inputModalityRefs,
    `${profileId}.inputModalityRefs`
  );

  if (modalityRefs.length === 0) {
    invalid(`InputModalityProfile ${profileId} must reference at least one InputModality`);
  }

  return {
    id: profile["@id"],
    label: optionalString(profile.label),
    modalities: modalityRefs.map((modalityRef) => resolveInputModality(index, modalityRef))
  };
}

function resolveInputModality(index: NodeIndex, modalityId: string): ResolvedInputModality {
  const modality = requireNode(index, modalityId, "InputModality");

  return {
    id: modality["@id"],
    label: optionalString(modality.label)
  };
}

function resolveTransitionEffects(index: NodeIndex, transition: AnyNode): ResolvedEffect[] {
  const effectRef = optionalString(transition.effectRef);
  return effectRef ? [resolveEffect(index, effectRef)] : [];
}

function resolveEffect(index: NodeIndex, effectId: string): ResolvedEffect {
  const effect = requireNode(index, effectId, "Effect");
  const producedRefs = optionalStringArray(effect.producedRefs);
  const consumedRefs = optionalStringArray(effect.consumedRefs);

  return {
    id: effect["@id"],
    label: optionalString(effect.label),
    producedRefs,
    consumedRefs,
    produced: producedRefs.map((artifactRef) => resolveArtifact(index, artifactRef)),
    consumed: consumedRefs.map((artifactRef) => resolveArtifact(index, artifactRef))
  };
}

function resolveArtifact(index: NodeIndex, artifactId: string): ResolvedArtifact {
  const artifact = requireNode(index, artifactId, "Artifact");
  const sourceTouchpointRef = optionalString(artifact.sourceTouchpointRef);
  if (sourceTouchpointRef) requireNode(index, sourceTouchpointRef, "Touchpoint");

  const targetTouchpointRefs = optionalStringArray(artifact.targetTouchpointRefs);
  for (const touchpointRef of targetTouchpointRefs) {
    requireNode(index, touchpointRef, "Touchpoint");
  }

  return {
    id: artifact["@id"],
    label: optionalString(artifact.label),
    nameRef: optionalString(artifact.nameRef),
    name: resolveMessage(index, artifact.nameRef),
    sourceTouchpointRef,
    targetTouchpointRefs
  };
}

function resolveMessage(index: NodeIndex, messageRef: unknown): string | undefined {
  if (messageRef === undefined) return undefined;

  const messageId = requiredString(messageRef, "messageRef");
  const messageNode = index.byId.get(messageId);
  if (!messageNode) {
    invalid(`Missing UJG node ${messageId}`);
  }

  if (hasType(messageNode, "MessageMeta")) {
    return resolveMessageMeta(index, messageNode);
  }
  if (hasType(messageNode, "Message")) {
    return requiredString(messageNode.value, `${messageId}.value`);
  }

  invalid(`Expected ${messageId} to be MessageMeta or Message`);
}

function resolveMessageMeta(index: NodeIndex, meta: AnyNode): string {
  const defaultLocaleRef = requiredString(
    meta.defaultLocaleRef,
    `${meta["@id"]}.defaultLocaleRef`
  );
  requireNode(index, defaultLocaleRef, "Locale");

  const messages = [...index.byId.values()].filter(
    (node) =>
      hasType(node, "Message") &&
      node.messageMetaRef === meta["@id"] &&
      node.localeRef === defaultLocaleRef
  );

  if (messages.length !== 1) {
    invalid(
      `Expected one Message for ${meta["@id"]} and ${defaultLocaleRef}, found ${messages.length}`
    );
  }

  return requiredString(messages[0].value, `${messages[0]["@id"]}.value`);
}

/** Select the owning composite and its descendants without compiling unrelated paths. */
function journeyComposites(index: NodeIndex, journeyId: string): ReadonlySet<string> {
  requireNode(index, journeyId, "Journey");
  const owner = requireOwningCompositeState(index, journeyId);
  const selected = new Set<string>();
  const visit = (composite: AnyNode): void => {
    if (selected.has(composite["@id"])) unsupported(`Cycle or repeated composite in journey ${journeyId}`);
    selected.add(composite["@id"]);
    const { journey } = compositeContextFor(index, composite["@id"]);
    for (const ref of requiredStringArray(journey.stateRefs, `${journey["@id"]}.stateRefs`)) {
      const node = index.byId.get(ref);
      if (node && hasType(node, "CompositeState")) visit(node);
    }
  };
  visit(owner);
  return selected;
}

/** RC4 allows shared and multiple child Journeys; linear lowering requires one owner and one child. */
function requireOwningCompositeState(index: NodeIndex, journeyId: string): AnyNode {
  const owners = nodesOfType(index, "CompositeState").filter((node) =>
    optionalStringArray(node.subjourneyRefs).includes(journeyId)
  );
  if (owners.length !== 1) unsupported(`Journey ${journeyId} must have exactly one owning CompositeState`);
  return owners[0];
}

function buildCompositeAssignments(index: NodeIndex, selected?: ReadonlySet<string>): Map<string, CompositeAssignment> {
  const assignments = new Map<string, CompositeAssignment>();
  const personas = nodesOfType(index, "Persona");

  for (const persona of personas) {
    const touchpointRefs = requiredStringArray(persona.touchpointRefs, `${persona["@id"]}.touchpointRefs`);
    for (const touchpointRef of touchpointRefs) {
      const touchpoint = requireNode(index, touchpointRef, "Touchpoint");
      const journeyRefs = optionalStringArray(touchpoint.journeyRefs);
      for (const journeyRef of journeyRefs) {
        if (selected && !nodesOfType(index, "CompositeState").some((node) => selected.has(node["@id"]) && optionalStringArray(node.subjourneyRefs).includes(journeyRef))) continue;
        const compositeId = requireOwningCompositeState(index, journeyRef)["@id"];
        assignCompositeAndChildren(index, assignments, compositeId, {
          personaId: persona["@id"],
          touchpointId: touchpoint["@id"]
        });
      }
    }
  }

  return assignments;
}

function assignCompositeAndChildren(
  index: NodeIndex,
  assignments: Map<string, CompositeAssignment>,
  compositeStateId: string,
  assignment: CompositeAssignment,
  seen: string[] = []
): void {
  if (seen.includes(compositeStateId)) {
    unsupported(`Cycle detected in CompositeState tree: ${[...seen, compositeStateId].join(" -> ")}`);
  }

  const existing = assignments.get(compositeStateId);
  if (existing) {
    if (existing.personaId !== assignment.personaId || existing.touchpointId !== assignment.touchpointId) {
      unsupported(`Conflicting persona/touchpoint assignment for ${compositeStateId}`);
    }
    return;
  }

  assignments.set(compositeStateId, assignment);
  const { journey } = compositeContextFor(index, compositeStateId);
  const stateRefs = requiredStringArray(journey.stateRefs, `${journey["@id"]}.stateRefs`);

  for (const stateRef of stateRefs) {
    const node = index.byId.get(stateRef);
    if (node && hasType(node, "CompositeState")) {
      assignCompositeAndChildren(index, assignments, stateRef, assignment, [
        ...seen,
        compositeStateId
      ]);
    }
  }
}

function buildParentCompositeMap(index: NodeIndex, selected?: ReadonlySet<string>): Map<string, string> {
  const parentByComposite = new Map<string, string>();

  for (const composite of nodesOfType(index, "CompositeState")) {
    if (selected && !selected.has(composite["@id"])) continue;
    const { journey } = compositeContextFor(index, composite["@id"]);
    const stateRefs = requiredStringArray(journey.stateRefs, `${journey["@id"]}.stateRefs`);

    for (const stateRef of stateRefs) {
      const node = index.byId.get(stateRef);
      if (!node || !hasType(node, "CompositeState")) continue;

      const existingParent = parentByComposite.get(stateRef);
      if (existingParent && existingParent !== composite["@id"]) {
        invalid(`CompositeState ${stateRef} has multiple parents`);
      }
      parentByComposite.set(stateRef, composite["@id"]);
    }
  }

  return parentByComposite;
}

function compositeContextFor(index: NodeIndex, compositeStateId: string): CompositeContext {
  const composite = requireNode(index, compositeStateId, "CompositeState");
  const subjourneyRefs = requiredStringArray(composite.subjourneyRefs, `${compositeStateId}.subjourneyRefs`);
  if (subjourneyRefs.length !== 1) {
    unsupported(
      `CompositeState ${compositeStateId} declares ${subjourneyRefs.length} subjourneyRefs; this compiler requires exactly 1`
    );
  }
  const journeyId = subjourneyRefs[0];
  const journey = requireNode(index, journeyId, "Journey");
  if (journey.defaultEntryRef === undefined) unsupported(`${journeyId}: linear lowering requires defaultEntryRef`);
  const defaultEntryRef = requiredString(journey.defaultEntryRef, `${journeyId}.defaultEntryRef`);
  const entryRefs = requiredStringArray(journey.entryRefs, `${journeyId}.entryRefs`);
  if (!entryRefs.includes(defaultEntryRef)) {
    invalid(`${journeyId}.defaultEntryRef must be listed in entryRefs`);
  }

  const entry = requireNode(index, defaultEntryRef, "JourneyEntry");
  const stateRef = requiredString(entry.stateRef, `${entry["@id"]}.stateRef`);
  const stateRefs = requiredStringArray(journey.stateRefs, `${journeyId}.stateRefs`);
  if (!stateRefs.includes(stateRef)) {
    invalid(`${entry["@id"]}.stateRef must be listed in ${journeyId}.stateRefs`);
  }

  return {
    composite,
    journey,
    entry,
    entryBinding: entryBindingForEntry(index, entry["@id"])
  };
}

function entryBindingForEntry(index: NodeIndex, entryId: string): EntryBindingRef | undefined {
  const bindings = nodesOfType(index, "EntryBinding").filter((binding) => binding.entryRef === entryId);
  if (bindings.length > 1) {
    unsupported(`Expected at most one EntryBinding for ${entryId}, found ${bindings.length}`);
  }
  if (bindings.length === 0) return undefined;

  const binding = bindings[0];
  return {
    id: binding["@id"],
    label: optionalString(binding.label),
    value: requiredString(binding.value, `${binding["@id"]}.value`)
  };
}

function sortedSteps(
  index: NodeIndex,
  steps: AnyNode[],
  phaseById: Map<string, AnyNode>
): AnyNode[] {
  return [...steps].sort((left, right) => {
    const leftPhaseId = requiredString(left.phaseRef, `${left["@id"]}.phaseRef`);
    const rightPhaseId = requiredString(right.phaseRef, `${right["@id"]}.phaseRef`);
    const leftPhase = phaseById.get(leftPhaseId) ?? requireNode(index, leftPhaseId, "Phase");
    const rightPhase = phaseById.get(rightPhaseId) ?? requireNode(index, rightPhaseId, "Phase");

    return (
      orderValue(leftPhase, index.sourceOrder.get(leftPhaseId) ?? 0) -
        orderValue(rightPhase, index.sourceOrder.get(rightPhaseId) ?? 0) ||
      orderValue(left, index.sourceOrder.get(left["@id"]) ?? 0) -
        orderValue(right, index.sourceOrder.get(right["@id"]) ?? 0)
    );
  });
}

function requireSingleActivationEventId(index: NodeIndex, surfaceId: string): string {
  const bindings = observationBindingsForSurface(index, surfaceId).filter((binding) => {
    const eventId = requiredString(
      binding.observationEventRef,
      `${binding["@id"]}.observationEventRef`
    );
    requireNode(index, eventId, "ObservationEvent");
    return !stateObservationEventIds.has(eventId);
  });

  if (bindings.length !== 1) {
    unsupported(
      `Expected one activation ObservationBinding for surface ${surfaceId}, found ${bindings.length}`
    );
  }

  return requiredString(
    bindings[0].observationEventRef,
    `${bindings[0]["@id"]}.observationEventRef`
  );
}

function isStateObservationBinding(index: NodeIndex, binding: AnyNode): boolean {
  const eventId = requiredString(
    binding.observationEventRef,
    `${binding["@id"]}.observationEventRef`
  );
  requireNode(index, eventId, "ObservationEvent");
  return stateObservationEventIds.has(eventId);
}

function observationBindingsForSurface(index: NodeIndex, surfaceId: string): AnyNode[] {
  return [...index.byId.values()].filter(
    (node) => hasType(node, "ObservationBinding") && node.observeSurfaceRef === surfaceId
  );
}

function requireSingleSurfaceForGraphNode(index: NodeIndex, graphNodeRef: string): AnyNode {
  const surfaces = [...index.byId.values()].filter(
    (node) => hasType(node, "Surface") && node.graphNodeRef === graphNodeRef
  );

  if (surfaces.length !== 1) {
    unsupported(`Expected one Surface for ${graphNodeRef}, found ${surfaces.length}`);
  }

  return surfaces[0];
}

function requireLocalVertex(index: NodeIndex, id: string): AnyNode {
  const node = index.byId.get(id);
  if (!node || (!hasType(node, "State") && !hasType(node, "CompositeState") && !hasType(node, "JourneyExit"))) {
    invalid(`Expected ${id} to be State, CompositeState, or JourneyExit`);
  }

  return node;
}

function graphVertexRef(node: AnyNode): GraphVertexRef {
  if (hasType(node, "State")) return { ...labeledRef(node), type: "State" };
  if (hasType(node, "CompositeState")) return { ...labeledRef(node), type: "CompositeState" };
  if (hasType(node, "JourneyExit")) return { ...labeledRef(node), type: "JourneyExit" };
  invalid(`Expected ${node["@id"]} to be a graph vertex`);
}

function labeledRef(node: AnyNode): LabeledRef {
  return {
    id: node["@id"],
    label: optionalString(node.label)
  };
}

function entryRef(node: AnyNode): JourneyEntryRef {
  return {
    ...labeledRef(node),
    stateId: requiredString(node.stateRef, `${node["@id"]}.stateRef`)
  };
}

function surfaceRef(node: AnyNode): LabeledRef {
  return labeledRef(node);
}

function transitionRef(node: AnyNode): TransitionPlanOperation["transition"] {
  return {
    ...labeledRef(node),
    from: requiredString(node.from, `${node["@id"]}.from`),
    to: requiredString(node.to, `${node["@id"]}.to`),
    effectRef: optionalString(node.effectRef)
  };
}

function controlFlowTransitionRef(node: AnyNode): ControlFlowPlanOperation["transition"] {
  return {
    ...labeledRef(node),
    from: requiredString(node.from, `${node["@id"]}.from`),
    to: requiredString(node.to, `${node["@id"]}.to`),
    fromExitRef: optionalString(node.fromExitRef),
    toEntryRef: optionalString(node.toEntryRef)
  };
}

function indexDocument(document: UjgDocument): NodeIndex {
  const byId = new Map<string, AnyNode>();
  const sourceOrder = new Map<string, number>();

  for (const [index, node] of (document.nodes ?? []).entries()) {
    if (!node || typeof node !== "object") {
      invalid(`UJG nodes[${index}] must be an object`);
    }

    const id = requiredString(node["@id"], `nodes[${index}].@id`);
    if (byId.has(id)) {
      invalid(`Duplicate UJG node id ${id}`);
    }

    byId.set(id, node as AnyNode);
    sourceOrder.set(id, index);
  }

  return { byId, sourceOrder };
}

function nodesOfType(index: NodeIndex, type: string): AnyNode[] {
  return [...index.byId.values()].filter((node) => hasType(node, type));
}

function requireNode(index: NodeIndex, id: string, type: string): AnyNode {
  const node = index.byId.get(id);
  if (!node) {
    invalid(`Missing UJG node ${id}`);
  }
  if (!hasType(node, type)) {
    invalid(`Expected ${id} to be ${type}, got ${typeList(node).join(", ")}`);
  }

  return node;
}

function hasType(node: UjgNode, type: string): boolean {
  return hasTypeValue(node["@type"], type);
}

function hasTypeValue(value: unknown, type: string): boolean {
  return Array.isArray(value) ? value.includes(type) : value === type;
}

function typeList(node: UjgNode): string[] {
  return Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
}

function orderValue(node: AnyNode, fallback: number): number {
  return typeof node.order === "number" ? node.order : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  return requiredStringArray(value, "string array");
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    invalid(`Expected ${label} to be a string`);
  }

  return value;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    invalid(`Expected ${label} to be a string array`);
  }

  return value;
}

function optionalExpectedMatchCount(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    invalid(`Expected ${label} to be a non-negative integer`);
  }

  return value;
}

function operationId(documentId: string, sequence: number, graphNodeId: string): string {
  return `${documentId}:operation:${String(sequence).padStart(3, "0")}:${safeIdSegment(graphNodeId)}`;
}

function safeIdSegment(value: string): string {
  return value.split(":").at(-1)?.replace(/[^a-zA-Z0-9_-]/g, "-") ?? "operation";
}


function assertSupportedSelection(index: NodeIndex, journeyId?: string): void {
  const journeys = new Set<string>();
  const inspect = (id: string): void => {
    if (journeys.has(id)) return;
    journeys.add(id);
    const journey = requireNode(index, id, "Journey");
    for (const stateId of optionalStringArray(journey.stateRefs)) {
      const state = index.byId.get(stateId)!;
      if (optionalStringArray(state.entryTransitionRefs).length) unsupported(`${stateId}: entry transition lowering is not implemented`);
      if (nodesOfType(index, "StateCollection").some((collection) => collection.memberStateRef === stateId)) unsupported(`${stateId}: StateCollection lowering is not implemented`);
      for (const child of optionalStringArray(state.subjourneyRefs)) inspect(child);
    }
    for (const transitionId of optionalStringArray(journey.transitionRefs)) {
      const transition = index.byId.get(transitionId)!;
      if (!hasType(transition, "Transition")) unsupported(`${transitionId}: AdjacentTransition lowering is not implemented`);
      if (transition.conditionRef !== undefined) unsupported(`${transitionId}: guarded branch lowering is not implemented`);
      if (transition.fromExitRef === undefined && transition.commandRef === undefined) unsupported(`${transitionId}: this lowering subset requires a Command Surface`);
    }
  };
  if (journeyId) inspect(journeyId);
  else for (const journey of nodesOfType(index, "Journey")) inspect(journey["@id"]);
}

function resolveMaterializations(index: NodeIndex, transitionId: string): import("@openuji/journey-execution-model").ResolvedTransitionMaterialization[] {
  return nodesOfType(index, "TransitionMaterialization")
    .filter((item) => item.materializationTransitionRef === transitionId)
    .map((item) => ({
      ...labeledRef(item), transitionId,
      modality: resolveInputModality(index, item.materializationModalityRef as string),
      ...(item.materializationStartLocatorRef ? { startLocator: resolveAccessibleLocator(index, item.materializationStartLocatorRef as string) } : {}),
      ...(item.materializationSourceStateRef ? { sourceStateId: item.materializationSourceStateRef as string } : {}),
      ...(item.materializationDirectionRef ? { direction: item.materializationDirectionRef as "operability:forward" | "operability:backward" } : {}),
      ...(item.extensions ? { extensions: item.extensions as Record<string, unknown> } : {}),
      steps: orderedSteps(index.byId, item).map((step) => ({
        ...labeledRef(step), kind: hasType(step, "MoveStep") ? "move" as const : hasType(step, "ActivationStep") ? "activation" as const : "shortcut" as const,
        ...(step.stepPreviousRef ? { previousStepId: step.stepPreviousRef as string } : {}),
        ...(step.stepLocatorRef ? { locator: resolveAccessibleLocator(index, step.stepLocatorRef as string) } : {}),
        ...(step.stepMoveKindRef ? { moveKind: { ...labeledRef(index.byId.get(step.stepMoveKindRef as string)!), type: hasType(index.byId.get(step.stepMoveKindRef as string)!, "FocusMoveKind") ? "focus" as const : "move" as const } } : {}),
        ...(step.extensions ? { extensions: step.extensions as Record<string, unknown> } : {})
      }))
    }));
}
