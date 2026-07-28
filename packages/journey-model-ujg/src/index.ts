import { readFile } from "node:fs/promises";

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

export type UjgNode = {
  "@id": string;
  "@type": string | string[];
  label?: string;
  [key: string]: unknown;
};

export type UjgDocument = {
  "@id": string;
  "@type": string | string[];
  nodes: UjgNode[];
};

type AnyNode = UjgNode & Record<string, unknown>;

type NodeIndex = {
  byId: Map<string, AnyNode>;
  sourceOrder: Map<string, number>;
};

type CompositeAssignment = {
  userId: string;
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

export function parseUjgDocument(source: string): UjgDocument {
  const parsed = JSON.parse(source) as Partial<UjgDocument>;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("UJG document must be a JSON object");
  }
  if (typeof parsed["@id"] !== "string") {
    throw new Error("UJG document must declare @id");
  }
  if (!hasTypeValue(parsed["@type"], "UJGDocument")) {
    throw new Error("UJG document must have @type UJGDocument");
  }
  if (!Array.isArray(parsed.nodes)) {
    throw new Error("UJG document must contain a top-level nodes array");
  }

  return parsed as UjgDocument;
}

export async function loadUjgDocument(input: URL | string): Promise<UjgDocument> {
  return parseUjgDocument(await readFile(input, "utf8"));
}

export async function compileUjgJourneyPlan(
  input: UjgDocument | URL | string
): Promise<JourneyPlan> {
  const document = isUjgDocument(input) ? input : await loadUjgDocument(input);
  return compileDocument(document);
}

function compileDocument(document: UjgDocument): JourneyPlan {
  const index = indexDocument(document);
  const assignmentByComposite = buildCompositeAssignments(index);
  const parentByComposite = buildParentCompositeMap(index);
  const phases = nodesOfType(index, "Phase");
  const steps = nodesOfType(index, "Step");
  const phaseById = new Map(phases.map((phase) => [phase["@id"], phase]));
  const operations: JourneyPlanOperation[] = [];

  for (const step of sortedSteps(index, steps, phaseById)) {
    const compositeStateId = requiredString(
      step.compositeStateRef,
      `${step["@id"]}.compositeStateRef`
    );
    const assignment = assignmentByComposite.get(compositeStateId);
    if (!assignment) {
      throw new Error(`No user/touchpoint assignment for ${compositeStateId}`);
    }

    const phaseId = requiredString(step.phaseRef, `${step["@id"]}.phaseRef`);
    requireNode(index, phaseId, "Phase");
    const compositeContext = compositeContextFor(index, compositeStateId);
    const path = buildStepPath(index, compositeStateId, parentByComposite);

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

  return {
    id: `${document["@id"]}:plan:v1`,
    source: {
      model: "ujg",
      documentId: document["@id"]
    },
    operations
  };
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
    actorId: assignment.userId,
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
      surface: surfaceRef(requireSingleSurfaceForGraphNode(index, transition["@id"])),
      activation,
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
  parentByComposite: Map<string, string>
): PathItem[] {
  const context = compositeContextFor(index, compositeStateId);
  const transitionRefs = requiredStringArray(
    context.journey.transitionRefs ?? [],
    `${context.journey["@id"]}.transitionRefs`
  );
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
      throw new Error(`Cycle detected while compiling ${compositeStateId} at ${current["@id"]}`);
    }
    visitedStates.add(current["@id"]);
    path.push({ kind: "state", node: current });

    const nextTransitions = transitions.filter((transition) => transition.from === current["@id"]);
    if (nextTransitions.length === 0) return path;
    if (nextTransitions.length > 1) {
      throw new Error(
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
        parentByComposite
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

    throw new Error(
      `Transition ${transition["@id"]} targets ${toId}; v1 step compilation supports State or JourneyExit targets`
    );
  }
}

function parentContinuationForExit({
  childCompositeId,
  exitId,
  index,
  parentByComposite
}: {
  childCompositeId: string;
  exitId: string;
  index: NodeIndex;
  parentByComposite: Map<string, string>;
}): { transition: AnyNode; toEntry?: AnyNode } | undefined {
  const parentCompositeId = parentByComposite.get(childCompositeId);
  if (!parentCompositeId) return undefined;

  const parentContext = compositeContextFor(index, parentCompositeId);
  const transitionRefs = optionalStringArray(parentContext.journey.transitionRefs);
  const transitions = transitionRefs
    .map((ref) => requireNode(index, ref, "Transition"))
    .filter(
      (transition) => transition.from === childCompositeId && transition.fromExitRef === exitId
    );

  if (transitions.length > 1) {
    throw new Error(`Ambiguous parent continuation for ${childCompositeId} exit ${exitId}`);
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
    throw new Error(`No state ObservationBinding found for surface ${surface["@id"]}`);
  }
  if (bindings.length !== 1) {
    throw new Error(
      `Expected one state ObservationBinding for surface ${surface["@id"]}, found ${bindings.length}`
    );
  }
  if (bindings[0].expectedMatchCount === undefined) {
    throw new Error(`State ObservationBinding ${bindings[0].id} must declare expectedMatchCount`);
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
  const surface = requireSingleSurfaceForGraphNode(index, transitionId);
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
    throw new Error(`No ${eventId} ObservationBinding found for surface ${surface["@id"]}`);
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
    throw new Error(`Cycle detected in AccessibleLocator context chain: ${[...seen, locatorId].join(" -> ")}`);
  }

  const locator = requireNode(index, locatorId, "AccessibleLocator");
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
    throw new Error(`InputModalityProfile ${profileId} must reference at least one InputModality`);
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
    throw new Error(`Missing UJG node ${messageId}`);
  }

  if (hasType(messageNode, "MessageMeta")) {
    return resolveMessageMeta(index, messageNode);
  }
  if (hasType(messageNode, "Message")) {
    return requiredString(messageNode.value, `${messageId}.value`);
  }

  throw new Error(`Expected ${messageId} to be MessageMeta or Message`);
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
    throw new Error(
      `Expected one Message for ${meta["@id"]} and ${defaultLocaleRef}, found ${messages.length}`
    );
  }

  return requiredString(messages[0].value, `${messages[0]["@id"]}.value`);
}

function buildCompositeAssignments(index: NodeIndex): Map<string, CompositeAssignment> {
  const assignments = new Map<string, CompositeAssignment>();
  const users = nodesOfType(index, "User");

  for (const user of users) {
    const touchpointRefs = requiredStringArray(user.touchpointRefs, `${user["@id"]}.touchpointRefs`);
    for (const touchpointRef of touchpointRefs) {
      const touchpoint = requireNode(index, touchpointRef, "Touchpoint");
      const compositeRefs = optionalStringArray(touchpoint.compositeStateRefs);
      for (const compositeRef of compositeRefs) {
        assignCompositeAndChildren(index, assignments, compositeRef, {
          userId: user["@id"],
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
    throw new Error(`Cycle detected in CompositeState tree: ${[...seen, compositeStateId].join(" -> ")}`);
  }

  const existing = assignments.get(compositeStateId);
  if (existing) {
    if (existing.userId !== assignment.userId || existing.touchpointId !== assignment.touchpointId) {
      throw new Error(`Conflicting user/touchpoint assignment for ${compositeStateId}`);
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

function buildParentCompositeMap(index: NodeIndex): Map<string, string> {
  const parentByComposite = new Map<string, string>();

  for (const composite of nodesOfType(index, "CompositeState")) {
    const { journey } = compositeContextFor(index, composite["@id"]);
    const stateRefs = requiredStringArray(journey.stateRefs, `${journey["@id"]}.stateRefs`);

    for (const stateRef of stateRefs) {
      const node = index.byId.get(stateRef);
      if (!node || !hasType(node, "CompositeState")) continue;

      const existingParent = parentByComposite.get(stateRef);
      if (existingParent && existingParent !== composite["@id"]) {
        throw new Error(`CompositeState ${stateRef} has multiple parents`);
      }
      parentByComposite.set(stateRef, composite["@id"]);
    }
  }

  return parentByComposite;
}

function compositeContextFor(index: NodeIndex, compositeStateId: string): CompositeContext {
  const composite = requireNode(index, compositeStateId, "CompositeState");
  const journeyId = requiredString(composite.subjourneyId, `${compositeStateId}.subjourneyId`);
  const journey = requireNode(index, journeyId, "Journey");
  const defaultEntryRef = requiredString(journey.defaultEntryRef, `${journeyId}.defaultEntryRef`);
  const entryRefs = requiredStringArray(journey.entryRefs, `${journeyId}.entryRefs`);
  if (!entryRefs.includes(defaultEntryRef)) {
    throw new Error(`${journeyId}.defaultEntryRef must be listed in entryRefs`);
  }

  const entry = requireNode(index, defaultEntryRef, "JourneyEntry");
  const stateRef = requiredString(entry.stateRef, `${entry["@id"]}.stateRef`);
  const stateRefs = requiredStringArray(journey.stateRefs, `${journeyId}.stateRefs`);
  if (!stateRefs.includes(stateRef)) {
    throw new Error(`${entry["@id"]}.stateRef must be listed in ${journeyId}.stateRefs`);
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
    throw new Error(`Expected at most one EntryBinding for ${entryId}, found ${bindings.length}`);
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
    throw new Error(
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
    throw new Error(`Expected one Surface for ${graphNodeRef}, found ${surfaces.length}`);
  }

  return surfaces[0];
}

function requireLocalVertex(index: NodeIndex, id: string): AnyNode {
  const node = index.byId.get(id);
  if (!node || (!hasType(node, "State") && !hasType(node, "CompositeState") && !hasType(node, "JourneyExit"))) {
    throw new Error(`Expected ${id} to be State, CompositeState, or JourneyExit`);
  }

  return node;
}

function graphVertexRef(node: AnyNode): GraphVertexRef {
  if (hasType(node, "State")) return { ...labeledRef(node), type: "State" };
  if (hasType(node, "CompositeState")) return { ...labeledRef(node), type: "CompositeState" };
  if (hasType(node, "JourneyExit")) return { ...labeledRef(node), type: "JourneyExit" };
  throw new Error(`Expected ${node["@id"]} to be a graph vertex`);
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

  for (const [index, node] of document.nodes.entries()) {
    if (!node || typeof node !== "object") {
      throw new Error(`UJG nodes[${index}] must be an object`);
    }

    const id = requiredString(node["@id"], `nodes[${index}].@id`);
    if (byId.has(id)) {
      throw new Error(`Duplicate UJG node id ${id}`);
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
    throw new Error(`Missing UJG node ${id}`);
  }
  if (!hasType(node, type)) {
    throw new Error(`Expected ${id} to be ${type}, got ${typeList(node).join(", ")}`);
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
    throw new Error(`Expected ${label} to be a string`);
  }

  return value;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Expected ${label} to be a string array`);
  }

  return value;
}

function optionalExpectedMatchCount(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Expected ${label} to be a non-negative integer`);
  }

  return value;
}

function operationId(documentId: string, sequence: number, graphNodeId: string): string {
  return `${documentId}:operation:${String(sequence).padStart(3, "0")}:${safeIdSegment(graphNodeId)}`;
}

function safeIdSegment(value: string): string {
  return value.split(":").at(-1)?.replace(/[^a-zA-Z0-9_-]/g, "-") ?? "operation";
}

function isUjgDocument(value: unknown): value is UjgDocument {
  return Boolean(
    value &&
      typeof value === "object" &&
      "@id" in value &&
      "nodes" in value &&
      Array.isArray((value as { nodes?: unknown }).nodes)
  );
}
