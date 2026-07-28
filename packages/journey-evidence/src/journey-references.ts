import type {
  JourneyPlan,
  JourneyPlanOperation,
  JourneySourceReferences,
  ResolvedAccessibleLocator
} from "@openuji/journey-execution-model";

import type {
  JourneyEvidenceSource,
  JourneyReferenceSet
} from "./index.js";

export function referencesForPlan(plan: JourneyPlan): JourneyReferenceSet | undefined {
  const source = sourceReferences(plan);
  return source ? { source } : undefined;
}

export function referencesForOperation(
  plan: JourneyPlan,
  operation: JourneyPlanOperation
): JourneyReferenceSet {
  const source = sourceReferences(plan, operation);
  const common: JourneyReferenceSet = {
    actorId: operation.actorId,
    touchpointId: operation.touchpointId,
    entryId: operation.entry.id,
    entryBindingId: operation.entryBinding?.id,
    ...(source ? { source } : {})
  };

  switch (operation.kind) {
    case "state":
      return {
        ...common,
        stateId: operation.state.id,
        surfaceId: operation.surface.id,
        observationBindingIds: operation.target.bindings.map((binding) => binding.id),
        observationEventIds: unique(operation.target.bindings.map((binding) => binding.eventId)),
        locatorIds: unique(operation.target.bindings.flatMap((binding) => locatorIds(binding.locators)))
      };

    case "transition":
      return {
        ...common,
        transitionId: operation.transition.id,
        surfaceId: operation.surface.id,
        observationBindingIds: operation.activation.bindings.map((binding) => binding.id),
        observationEventIds: unique(operation.activation.bindings.map((binding) => binding.eventId)),
        locatorIds: unique(operation.activation.bindings.flatMap((binding) => locatorIds(binding.locators))),
        effectIds: operation.effects.map((effect) => effect.id),
        artifactIds: unique(
          operation.effects.flatMap((effect) => [...effect.producedRefs, ...effect.consumedRefs])
        )
      };

    case "control-flow":
      return {
        ...common,
        transitionId: operation.transition.id
      };
  }
}

function sourceReferences(
  plan: JourneyPlan,
  operation?: JourneyPlanOperation
): JourneyEvidenceSource | undefined {
  if (!plan.source) return undefined;

  return {
    model: plan.source.model,
    ...(plan.source.documentId ? { documentId: plan.source.documentId } : {}),
    ...(plan.source.references ? { planReferences: plan.source.references } : {}),
    ...(operation?.source?.references ? { operationReferences: operation.source.references } : {})
  };
}

function locatorIds(locators: ResolvedAccessibleLocator[]): string[] {
  return locators.flatMap((locator) => [locator.id, ...locatorIds(locator.contexts)]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
