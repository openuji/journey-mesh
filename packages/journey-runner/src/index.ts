import {
  EvidenceRecorder,
  errorToEvidence,
  type ControlFlowPlanOperation,
  type EvidenceError,
  type EvidenceEvent,
  type EvidenceEventInput,
  type InputModalityDecision,
  type JourneyPlan,
  type JourneyPlanOperation,
  type JsonObject,
  type ResolvedAccessibleLocator,
  type StatePlanOperation,
  type TransitionPlanOperation,
  type UjgRefSet
} from "@openuji/journey-evidence";

export { EvidenceRecorder, errorToEvidence } from "@openuji/journey-evidence";

export type {
  AccessibleFeature,
  ControlFlowPlanOperation,
  EntryBindingRef,
  EvidenceError,
  EvidenceEvent,
  EvidenceEventInput,
  GraphVertexRef,
  InputModalityDecision,
  JourneyInteractionCommand,
  JourneyPlan,
  JourneyPlanOperation,
  JourneyPlanOperationKind,
  JsonObject,
  JsonPrimitive,
  JsonValue,
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
  TransitionPlanOperation,
  UjgRefSet
} from "@openuji/journey-evidence";

export type AdapterExecutionContext = {
  runId: string;
  executionId: string;
  profile: JourneyProfile;
  plan: JourneyPlan;
  evidence: EvidenceRecorder;
};

export type JourneyAdapter = {
  name: string;
  version?: string;
  setupExecution(context: AdapterExecutionContext): Promise<void> | void;
  openEntry(
    operation: JourneyPlanOperation,
    context: AdapterExecutionContext
  ): Promise<void> | void;
  assertState(
    operation: StatePlanOperation,
    context: AdapterExecutionContext
  ): Promise<void> | void;
  performTransition(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision,
    context: AdapterExecutionContext
  ): Promise<void> | void;
  recordControlFlow(
    operation: ControlFlowPlanOperation,
    context: AdapterExecutionContext
  ): Promise<void> | void;
  teardownExecution(context: AdapterExecutionContext): Promise<void> | void;
};

export type JourneyProfile = {
  id: string;
  label?: string;
  selectInputModality(
    operation: TransitionPlanOperation,
    context: AdapterExecutionContext
  ): Promise<InputModalityDecision> | InputModalityDecision;
};

export type JourneyObserver = {
  name: string;
  version?: string;
};

export type JourneyReporter = {
  name: string;
  version?: string;
  report(result: RunResult): Promise<void> | void;
};

export type RunJourneyOptions = {
  plan: JourneyPlan;
  adapter: JourneyAdapter;
  profiles: JourneyProfile[];
  observers?: JourneyObserver[];
  reporters?: JourneyReporter[];
  runId?: string;
};

export type ExecutionResult = {
  executionId: string;
  profileId: string;
  ok: boolean;
  error?: EvidenceError;
};

export type RunResult = {
  ok: boolean;
  runId: string;
  planId: string;
  documentId: string;
  executions: ExecutionResult[];
  evidence: {
    events: EvidenceEvent[];
  };
  errors: EvidenceError[];
};

export async function runJourney(options: RunJourneyOptions): Promise<RunResult> {
  if (options.profiles.length === 0) {
    throw new Error("runJourney requires at least one profile");
  }

  const runId = options.runId ?? `run-${new Date().toISOString()}`;
  const evidence = new EvidenceRecorder(runId);
  const executions: ExecutionResult[] = [];
  const errors: EvidenceError[] = [];

  evidence.emit({
    type: "runner.run.started",
    ok: true,
    ujg: { documentId: options.plan.documentId },
    data: {
      planId: options.plan.id,
      operationCount: options.plan.operations.length,
      profiles: options.profiles.map((profile) => profile.id),
      adapter: componentData(options.adapter),
      observers: (options.observers ?? []).map(componentData),
      reporters: (options.reporters ?? []).map(componentData)
    }
  });

  for (const [profileIndex, profile] of options.profiles.entries()) {
    const executionId = `${safeSegment(profile.id)}-${String(profileIndex + 1).padStart(2, "0")}`;
    const context: AdapterExecutionContext = {
      runId,
      executionId,
      profile,
      plan: options.plan,
      evidence
    };

    const execution = await runProfileExecution({
      adapter: options.adapter,
      context,
      evidence,
      plan: options.plan,
      profile
    });

    executions.push(execution);
    if (execution.error) errors.push(execution.error);
  }

  let ok = executions.every((execution) => execution.ok);
  let result = buildResult({
    documentId: options.plan.documentId,
    errors,
    events: evidence.snapshot(),
    executions,
    ok,
    planId: options.plan.id,
    runId
  });

  for (const reporter of options.reporters ?? []) {
    try {
      evidence.emit({
        type: "reporter.started",
        ok: true,
        data: componentData(reporter)
      });
      await reporter.report(result);
      evidence.emit({
        type: "reporter.completed",
        ok: true,
        data: componentData(reporter)
      });
    } catch (error) {
      ok = false;
      const evidenceError = errorToEvidence(error);
      errors.push(evidenceError);
      evidence.emit({
        type: "reporter.failed",
        ok: false,
        data: componentData(reporter),
        error: evidenceError
      });
    }

    result = buildResult({
      documentId: options.plan.documentId,
      errors,
      events: evidence.snapshot(),
      executions,
      ok,
      planId: options.plan.id,
      runId
    });
  }

  evidence.emit({
    type: "runner.run.completed",
    ok,
    ujg: { documentId: options.plan.documentId },
    data: {
      planId: options.plan.id,
      executionCount: executions.length,
      errorCount: errors.length
    }
  });

  return buildResult({
    documentId: options.plan.documentId,
    errors,
    events: evidence.snapshot(),
    executions,
    ok,
    planId: options.plan.id,
    runId
  });
}

async function runProfileExecution({
  adapter,
  context,
  evidence,
  plan,
  profile
}: {
  adapter: JourneyAdapter;
  context: AdapterExecutionContext;
  evidence: EvidenceRecorder;
  plan: JourneyPlan;
  profile: JourneyProfile;
}): Promise<ExecutionResult> {
  let ok = true;
  let executionError: EvidenceError | undefined;
  const currentEntryByUser = new Map<string, string>();

  evidence.emit({
    type: "profile.execution.started",
    executionId: context.executionId,
    profileId: profile.id,
    ok: true,
    ujg: { documentId: plan.documentId },
    data: { label: profile.label ?? profile.id }
  });

  try {
    evidence.emit({
      type: "adapter.setup.started",
      executionId: context.executionId,
      profileId: profile.id,
      ok: true,
      data: componentData(adapter)
    });
    await adapter.setupExecution(context);
    evidence.emit({
      type: "adapter.setup.completed",
      executionId: context.executionId,
      profileId: profile.id,
      ok: true,
      data: componentData(adapter)
    });

    for (const operation of plan.operations) {
      evidence.emit(operationEvent(operation, context, "operation.started", true));
      await ensureEntryOpen({ adapter, context, currentEntryByUser, evidence, operation });

      if (operation.kind === "state") {
        await assertState({ adapter, context, evidence, operation });
      } else if (operation.kind === "transition") {
        await performTransition({ adapter, context, evidence, operation, profile });
      } else {
        await recordControlFlow({ adapter, context, evidence, operation });
      }

      evidence.emit(operationEvent(operation, context, "operation.completed", true));
    }
  } catch (error) {
    ok = false;
    executionError = errorToEvidence(error);
    evidence.emit({
      type: "profile.execution.failed",
      executionId: context.executionId,
      profileId: profile.id,
      ok: false,
      error: executionError
    });
  } finally {
    try {
      evidence.emit({
        type: "adapter.teardown.started",
        executionId: context.executionId,
        profileId: profile.id,
        ok: true,
        data: componentData(adapter)
      });
      await adapter.teardownExecution(context);
      evidence.emit({
        type: "adapter.teardown.completed",
        executionId: context.executionId,
        profileId: profile.id,
        ok: true,
        data: componentData(adapter)
      });
    } catch (error) {
      ok = false;
      executionError = errorToEvidence(error);
      evidence.emit({
        type: "adapter.teardown.failed",
        executionId: context.executionId,
        profileId: profile.id,
        ok: false,
        error: executionError,
        data: componentData(adapter)
      });
    }
  }

  evidence.emit({
    type: "profile.execution.completed",
    executionId: context.executionId,
    profileId: profile.id,
    ok,
    error: executionError
  });

  return {
    executionId: context.executionId,
    profileId: profile.id,
    ok,
    error: executionError
  };
}

async function ensureEntryOpen({
  adapter,
  context,
  currentEntryByUser,
  evidence,
  operation
}: {
  adapter: JourneyAdapter;
  context: AdapterExecutionContext;
  currentEntryByUser: Map<string, string>;
  evidence: EvidenceRecorder;
  operation: JourneyPlanOperation;
}): Promise<void> {
  if (!operation.entryBinding) return;

  const entryKey = `${operation.entry.id}\u0000${operation.entryBinding.id}\u0000${operation.entryBinding.value}`;
  if (currentEntryByUser.get(operation.userId) === entryKey) return;

  evidence.emit(operationEvent(operation, context, "adapter.open-entry.started", true, {
    entryBindingValue: operation.entryBinding.value
  }));
  await adapter.openEntry(operation, context);
  currentEntryByUser.set(operation.userId, entryKey);
  evidence.emit(operationEvent(operation, context, "adapter.open-entry.completed", true, {
    entryBindingValue: operation.entryBinding.value
  }));
}

async function assertState({
  adapter,
  context,
  evidence,
  operation
}: {
  adapter: JourneyAdapter;
  context: AdapterExecutionContext;
  evidence: EvidenceRecorder;
  operation: StatePlanOperation;
}): Promise<void> {
  evidence.emit(operationEvent(operation, context, "adapter.assert-state.started", true, {
    expectedMatchCount: operation.target.expectedMatchCount
  }));
  await adapter.assertState(operation, context);
  evidence.emit(operationEvent(operation, context, "adapter.assert-state.completed", true, {
    expectedMatchCount: operation.target.expectedMatchCount
  }));
}

async function performTransition({
  adapter,
  context,
  evidence,
  operation,
  profile
}: {
  adapter: JourneyAdapter;
  context: AdapterExecutionContext;
  evidence: EvidenceRecorder;
  operation: TransitionPlanOperation;
  profile: JourneyProfile;
}): Promise<void> {
  const decision = await profile.selectInputModality(operation, context);

  evidence.emit(operationEvent(operation, context, "profile.modality.selected", true, {
    command: decision.command,
    inputModalityProfileId: decision.inputModalityProfile.id,
    modalityId: decision.modality.id
  }));

  evidence.emit(operationEvent(operation, context, "adapter.perform-transition.started", true, {
    command: decision.command
  }));
  await adapter.performTransition(operation, decision, context);
  evidence.emit(operationEvent(operation, context, "adapter.perform-transition.completed", true, {
    command: decision.command
  }));

  for (const effect of operation.effects) {
    evidence.emit(operationEvent(operation, context, "effect.recorded", true, {
      effectId: effect.id,
      producedRefs: effect.producedRefs,
      consumedRefs: effect.consumedRefs
    }));
  }
}

async function recordControlFlow({
  adapter,
  context,
  evidence,
  operation
}: {
  adapter: JourneyAdapter;
  context: AdapterExecutionContext;
  evidence: EvidenceRecorder;
  operation: ControlFlowPlanOperation;
}): Promise<void> {
  evidence.emit(operationEvent(operation, context, "adapter.control-flow.started", true));
  await adapter.recordControlFlow(operation, context);
  evidence.emit(operationEvent(operation, context, "adapter.control-flow.completed", true));
}

function operationEvent(
  operation: JourneyPlanOperation,
  context: AdapterExecutionContext,
  type: string,
  ok: boolean,
  data?: JsonObject
): EvidenceEventInput {
  return {
    type,
    executionId: context.executionId,
    profileId: context.profile.id,
    operationId: operation.id,
    operationKind: operation.kind,
    ok,
    ujg: ujgRefsForOperation(operation),
    data
  };
}

function ujgRefsForOperation(operation: JourneyPlanOperation): UjgRefSet {
  const refs: UjgRefSet = {
    documentId: operation.documentId,
    phaseId: operation.phaseId,
    stepId: operation.stepId,
    userId: operation.userId,
    touchpointId: operation.touchpointId,
    entryId: operation.entry.id,
    entryBindingId: operation.entryBinding?.id
  };

  if (operation.kind === "state") {
    refs.stateId = operation.state.id;
    refs.surfaceId = operation.surface.id;
    refs.observationBindingIds = operation.target.bindings.map((binding) => binding.id);
    refs.observationEventIds = unique(operation.target.bindings.map((binding) => binding.eventId));
    refs.locatorIds = unique(operation.target.bindings.flatMap((binding) => locatorIds(binding.locators)));
    return refs;
  }

  refs.transitionId = operation.transition.id;

  if (operation.kind === "transition") {
    refs.surfaceId = operation.surface.id;
    refs.observationBindingIds = operation.activation.bindings.map((binding) => binding.id);
    refs.observationEventIds = unique(operation.activation.bindings.map((binding) => binding.eventId));
    refs.locatorIds = unique(operation.activation.bindings.flatMap((binding) => locatorIds(binding.locators)));
    refs.effectIds = operation.effects.map((effect) => effect.id);
    refs.artifactIds = unique(
      operation.effects.flatMap((effect) => [...effect.producedRefs, ...effect.consumedRefs])
    );
  }

  return refs;
}

function locatorIds(locators: ResolvedAccessibleLocator[]): string[] {
  return locators.flatMap((locator) => [locator.id, ...locatorIds(locator.contexts)]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function componentData(component: { name: string; version?: string }): JsonObject {
  return {
    name: component.name,
    ...(component.version ? { version: component.version } : {})
  };
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function buildResult({
  documentId,
  errors,
  events,
  executions,
  ok,
  planId,
  runId
}: {
  documentId: string;
  errors: EvidenceError[];
  events: EvidenceEvent[];
  executions: ExecutionResult[];
  ok: boolean;
  planId: string;
  runId: string;
}): RunResult {
  return {
    ok,
    runId,
    planId,
    documentId,
    executions: [...executions],
    evidence: { events },
    errors: [...errors]
  };
}
