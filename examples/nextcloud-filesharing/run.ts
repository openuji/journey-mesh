import { compileUjgJourneyPlan } from "@openuji/journey-model-ujg";
import { defaultProfile, keyboardOnlyProfile } from "@openuji/journey-profiles";
import { runJourney, type JourneyAdapter } from "@openuji/journey-runner";

const journey = new URL("./ujg/filesharing.ujg.jsonld", import.meta.url);

const dummyAdapter: JourneyAdapter = {
  name: "@openuji/journey-adapter-dummy",
  version: "0.1.0",

  setupExecution(context) {
    context.evidence.emit({
      type: "dummy-adapter.call",
      executionId: context.executionId,
      profileId: context.profile.id,
      ok: true,
      message: "setupExecution"
    });
  },

  openEntry(operation, context) {
    context.evidence.emit({
      type: "dummy-adapter.call",
      executionId: context.executionId,
      profileId: context.profile.id,
      operationId: operation.id,
      operationKind: operation.kind,
      ok: true,
      message: "openEntry",
      ujg: {
        documentId: operation.documentId,
        entryId: operation.entry.id,
        entryBindingId: operation.entryBinding?.id,
        userId: operation.userId,
        touchpointId: operation.touchpointId
      },
      data: {
        entryBindingValue: operation.entryBinding?.value ?? null
      }
    });
  },

  assertState(operation, context) {
    context.evidence.emit({
      type: "dummy-adapter.call",
      executionId: context.executionId,
      profileId: context.profile.id,
      operationId: operation.id,
      operationKind: operation.kind,
      ok: true,
      message: "assertState",
      ujg: {
        documentId: operation.documentId,
        stateId: operation.state.id,
        surfaceId: operation.surface.id,
        observationBindingIds: operation.target.bindings.map((binding) => binding.id),
        locatorIds: operation.target.bindings.flatMap((binding) =>
          binding.locators.map((locator) => locator.id)
        )
      },
      data: {
        expectedMatchCount: operation.target.expectedMatchCount
      }
    });
  },

  performTransition(operation, decision, context) {
    context.evidence.emit({
      type: "dummy-adapter.call",
      executionId: context.executionId,
      profileId: context.profile.id,
      operationId: operation.id,
      operationKind: operation.kind,
      ok: true,
      message: "performTransition",
      ujg: {
        documentId: operation.documentId,
        transitionId: operation.transition.id,
        surfaceId: operation.surface.id,
        observationBindingIds: operation.activation.bindings.map((binding) => binding.id),
        locatorIds: operation.activation.bindings.flatMap((binding) =>
          binding.locators.map((locator) => locator.id)
        ),
        effectIds: operation.effects.map((effect) => effect.id)
      },
      data: {
        command: decision.command,
        inputModalityProfileId: decision.inputModalityProfile.id,
        modalityId: decision.modality.id
      }
    });
  },

  recordControlFlow(operation, context) {
    context.evidence.emit({
      type: "dummy-adapter.call",
      executionId: context.executionId,
      profileId: context.profile.id,
      operationId: operation.id,
      operationKind: operation.kind,
      ok: true,
      message: "recordControlFlow",
      ujg: {
        documentId: operation.documentId,
        transitionId: operation.transition.id,
        entryId: operation.toEntry?.id,
        userId: operation.userId,
        touchpointId: operation.touchpointId
      },
      data: {
        fromExitRef: operation.transition.fromExitRef ?? null,
        toEntryRef: operation.transition.toEntryRef ?? null
      }
    });
  },

  teardownExecution(context) {
    context.evidence.emit({
      type: "dummy-adapter.call",
      executionId: context.executionId,
      profileId: context.profile.id,
      ok: true,
      message: "teardownExecution"
    });
  }
};

const plan = await compileUjgJourneyPlan(journey);
const result = await runJourney({
  plan,
  adapter: dummyAdapter,
  profiles: [defaultProfile(), keyboardOnlyProfile()]
});

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
