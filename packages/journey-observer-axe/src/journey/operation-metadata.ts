import type {
  JourneyOperationSource,
  JourneyPlanSource,
  JourneySourceReferences,
  JsonObject,
  ResolvedAccessibleLocator,
  ResolvedEffect,
  ResolvedObservationBinding,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-runner";

import type {
  AxeAuditMetadata,
  AxeJourneyOperation
} from "../types.js";
import { addOptional, unique } from "../shared/json.js";

export function metadataForOperation(
  profileId: string,
  executionId: string,
  graphNodeId: string,
  operation: AxeJourneyOperation
): AxeAuditMetadata {
  const metadata: AxeAuditMetadata = {
    profileId,
    executionId,
    operationId: operation.id,
    sequence: operation.sequence,
    kind: operation.kind,
    graphNodeId,
    actorId: operation.actorId,
    touchpointId: operation.touchpointId,
    entryId: operation.entry.id
  };

  addOptional(metadata, "source", operationSourceMetadata(operation.source));
  addOptional(metadata, "entryBindingId", operation.entryBinding?.id);
  addOptional(metadata, "entryBindingValue", operation.entryBinding?.value);

  if (operation.kind === "state") {
    return stateOperationMetadata(metadata, operation);
  }

  if (operation.kind === "transition") {
    return transitionOperationMetadata(metadata, operation);
  }

  return controlFlowOperationMetadata(metadata, operation);
}

export function planSourceMetadata(source: JourneyPlanSource | undefined): JsonObject | undefined {
  if (!source) return undefined;

  const metadata: JsonObject = {
    model: source.model
  };
  addOptional(metadata, "documentId", source.documentId);
  addOptional(metadata, "references", sourceReferencesMetadata(source.references));
  return metadata;
}

function stateOperationMetadata(
  metadata: AxeAuditMetadata,
  operation: StatePlanOperation
): AxeAuditMetadata {
  metadata.stateId = operation.state.id;
  metadata.surfaceId = operation.surface.id;
  metadata.expectedMatchCount = operation.target.expectedMatchCount;
  metadata.bindingIds = operation.target.bindings.map((binding) => binding.id);
  metadata.locatorIds = locatorIds(operation.target.bindings);
  metadata.bindings = operation.target.bindings.map(bindingMetadata);
  addOptional(metadata, "stateLabel", operation.state.label);
  addOptional(metadata, "surfaceLabel", operation.surface.label);
  addUniqueEventMetadata(metadata, operation.target.bindings.map((binding) => binding.eventId));
  return metadata;
}

function transitionOperationMetadata(
  metadata: AxeAuditMetadata,
  operation: TransitionPlanOperation
): AxeAuditMetadata {
  metadata.transitionId = operation.transition.id;
  metadata.fromStateId = operation.transition.from;
  metadata.toStateId = operation.transition.to;
  metadata.surfaceId = operation.surface.id;
  metadata.eventId = operation.activation.eventId;
  metadata.bindingIds = operation.activation.bindings.map((binding) => binding.id);
  metadata.locatorIds = locatorIds(operation.activation.bindings);
  metadata.bindings = operation.activation.bindings.map(bindingMetadata);
  metadata.effects = operation.effects.map(effectMetadata);
  metadata.effectIds = operation.effects.map((effect) => effect.id);
  metadata.artifactIds = unique(
    operation.effects.flatMap((effect) => [...effect.producedRefs, ...effect.consumedRefs])
  );
  addOptional(metadata, "transitionLabel", operation.transition.label);
  addOptional(metadata, "surfaceLabel", operation.surface.label);
  addOptional(metadata, "eventLabel", operation.activation.eventLabel);
  addOptional(metadata, "effectRef", operation.transition.effectRef);
  return metadata;
}

function controlFlowOperationMetadata(
  metadata: AxeAuditMetadata,
  operation: Exclude<AxeJourneyOperation, StatePlanOperation | TransitionPlanOperation>
): AxeAuditMetadata {
  metadata.transitionId = operation.transition.id;
  addOptional(metadata, "transitionLabel", operation.transition.label);
  addOptional(metadata, "fromExitRef", operation.transition.fromExitRef);
  addOptional(metadata, "toEntryRef", operation.transition.toEntryRef);
  return metadata;
}

function operationSourceMetadata(source: JourneyOperationSource | undefined): JsonObject | undefined {
  if (!source) return undefined;

  const metadata: JsonObject = {};
  addOptional(metadata, "references", sourceReferencesMetadata(source.references));
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function sourceReferencesMetadata(references: JourneySourceReferences | undefined): JsonObject | undefined {
  if (!references) return undefined;

  const metadata: JsonObject = {};
  for (const [key, value] of Object.entries(references)) {
    metadata[key] = typeof value === "string" ? value : [...value];
  }
  return metadata;
}

function bindingMetadata(binding: ResolvedObservationBinding): JsonObject {
  const metadata: JsonObject = {
    bindingId: binding.id,
    surfaceId: binding.surfaceId,
    eventId: binding.eventId,
    locatorIds: binding.locators.flatMap((locator) => collectLocatorIds(locator)),
    locators: binding.locators.map(locatorMetadata)
  };

  addOptional(metadata, "label", binding.label);
  addOptional(metadata, "eventLabel", binding.eventLabel);
  if (binding.expectedMatchCount !== undefined) {
    metadata.expectedMatchCount = binding.expectedMatchCount;
  }
  if (binding.surfaceInstanceResolver) {
    metadata.surfaceInstanceResolver = {
      resolverId: binding.surfaceInstanceResolver.id,
      feature: featureMetadata(binding.surfaceInstanceResolver.instanceKeyFeature)
    };
  }

  return metadata;
}

function locatorMetadata(locator: ResolvedAccessibleLocator): JsonObject {
  const metadata: JsonObject = {
    locatorId: locator.id,
    features: locator.features.map(featureMetadata),
    contexts: locator.contexts.map(locatorMetadata)
  };

  addOptional(metadata, "label", locator.label);
  addOptional(metadata, "role", locator.role);
  addOptional(metadata, "accessibleName", locator.accessibleName);
  addOptional(metadata, "accessibleDescription", locator.accessibleDescription);
  return metadata;
}

function featureMetadata(feature: { id: string; name: string; value: string; label?: string }): JsonObject {
  const metadata: JsonObject = {
    featureId: feature.id,
    name: feature.name,
    value: feature.value
  };
  addOptional(metadata, "label", feature.label);
  return metadata;
}

function effectMetadata(effect: ResolvedEffect): JsonObject {
  return {
    effectId: effect.id,
    producedRefs: [...effect.producedRefs],
    consumedRefs: [...effect.consumedRefs],
    produced: effect.produced.map(artifactMetadata),
    consumed: effect.consumed.map(artifactMetadata)
  };
}

function artifactMetadata(artifact: ResolvedEffect["produced"][number]): JsonObject {
  const metadata: JsonObject = {
    artifactId: artifact.id,
    targetTouchpointRefs: [...artifact.targetTouchpointRefs]
  };
  addOptional(metadata, "label", artifact.label);
  addOptional(metadata, "nameRef", artifact.nameRef);
  addOptional(metadata, "name", artifact.name);
  addOptional(metadata, "sourceTouchpointRef", artifact.sourceTouchpointRef);
  return metadata;
}

function addUniqueEventMetadata(metadata: JsonObject, eventIds: string[]): void {
  const uniqueEventIds = unique(eventIds);
  metadata.eventIds = uniqueEventIds;
  if (uniqueEventIds.length === 1) {
    metadata.eventId = uniqueEventIds[0];
  }
}

function locatorIds(bindings: ResolvedObservationBinding[]): string[] {
  return unique(
    bindings.flatMap((binding) => binding.locators.flatMap((locator) => collectLocatorIds(locator)))
  );
}

function collectLocatorIds(locator: ResolvedAccessibleLocator): string[] {
  return [locator.id, ...locator.contexts.flatMap((context) => collectLocatorIds(context))];
}
