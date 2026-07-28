import type {
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyPlan,
  JourneyPlanSource,
  JourneyPlanOperation,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";
import {
  EvidenceRecorder,
  errorToEvidence,
  referencesForOperation,
  referencesForPlan,
  type EvidenceError,
  type EvidenceEvent,
  type EvidenceEventInput,
  type JsonObject
} from "@openuji/journey-evidence";

export {
  EvidenceRecorder,
  errorToEvidence,
  referencesForOperation,
  referencesForPlan
} from "@openuji/journey-evidence";

export type {
  AccessibleFeature,
  ControlFlowPlanOperation,
  EntryBindingRef,
  GraphVertexRef,
  InputModalityDecision,
  JourneyEntryRef,
  JourneyInteractionCommand,
  JourneyOperationSource,
  JourneyPlan,
  JourneyPlanOperation,
  JourneyPlanOperationBase,
  JourneyPlanOperationKind,
  JourneyPlanSource,
  JourneySourceReferences,
  JourneySourceReferenceValue,
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

export type {
  EvidenceError,
  EvidenceEvent,
  EvidenceEventInput,
  JourneyEvidenceSource,
  JourneyReferenceSet,
  JsonObject,
  JsonPrimitive,
  JsonValue
} from "@openuji/journey-evidence";

export type JourneyExecutionContext = {
  readonly runId: string;
  readonly executionId: string;
  readonly profile: JourneyProfile;
  readonly plan: JourneyPlan;
  readonly evidence: EvidenceRecorder;
  readonly observers: readonly JourneyObserver[];
};

/**
 * @deprecated Use JourneyExecutionContext.
 */
export type AdapterExecutionContext = JourneyExecutionContext;

export type JourneyAdapterCloseInput = {
  readonly executionFailed: boolean;
};

export type JourneyAdapter = {
  readonly name: string;
  readonly version?: string;
  createExecution(context: JourneyExecutionContext): JourneyAdapterExecution;
};

export type JourneyAdapterExecution = {
  start(): Promise<void> | void;
  openEntry(operation: JourneyPlanOperation): Promise<void> | void;
  assertState(operation: StatePlanOperation): Promise<void> | void;
  performTransition(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision
  ): Promise<void> | void;
  recordControlFlow(operation: ControlFlowPlanOperation): Promise<void> | void;
  close(input: JourneyAdapterCloseInput): Promise<void> | void;
};

export type JourneyProfile = {
  id: string;
  label?: string;
  selectInputModality(
    operation: TransitionPlanOperation,
    context: JourneyExecutionContext
  ): Promise<InputModalityDecision> | InputModalityDecision;
};

export type JourneyObserver = {
  name: string;
  version?: string;
  onRunStarted?(input: JourneyObserverRunStartedInput): Promise<void> | void;
  onRunCompleted?(input: JourneyObserverRunCompletedInput): Promise<void> | void;
  onExecutionStarted?(input: JourneyObserverExecutionInput): Promise<void> | void;
  onExecutionCompleted?(input: JourneyObserverExecutionCompletedInput): Promise<void> | void;
};

export type JourneyObserverRunStartedInput = {
  runId: string;
  plan: JourneyPlan;
  profiles: readonly JourneyProfile[];
  adapter: JourneyAdapter;
  evidence: EvidenceRecorder;
};

export type JourneyObserverRunCompletedInput = {
  result: RunResult;
  evidence: EvidenceRecorder;
};

export type JourneyObserverExecutionInput = {
  context: JourneyExecutionContext;
};

export type JourneyObserverExecutionCompletedInput = {
  context: JourneyExecutionContext;
  execution: ExecutionResult;
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
  plan: {
    id: string;
    source?: JourneyPlanSource;
  };
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
  const observers = options.observers ?? [];

  evidence.emit({
    type: "runner.run.started",
    ok: true,
    references: referencesForPlan(options.plan),
    data: {
      planId: options.plan.id,
      operationCount: options.plan.operations.length,
      profiles: options.profiles.map((profile) => profile.id),
      adapter: componentData(options.adapter),
      observers: observers.map(componentData),
      reporters: (options.reporters ?? []).map(componentData)
    }
  });

  const runStartError = await notifyRunStarted({
    adapter: options.adapter,
    evidence,
    observers,
    plan: options.plan,
    profiles: options.profiles,
    runId
  });
  if (runStartError) {
    errors.push(runStartError);
    evidence.emit({
      type: "runner.run.completed",
      ok: false,
      references: referencesForPlan(options.plan),
      data: {
        planId: options.plan.id,
        executionCount: 0,
        errorCount: errors.length
      }
    });
    return buildResult({
      errors,
      events: evidence.snapshot(),
      executions,
      ok: false,
      plan: options.plan,
      runId
    });
  }

  for (const [profileIndex, profile] of options.profiles.entries()) {
    const executionId = `${safeSegment(profile.id)}-${String(profileIndex + 1).padStart(2, "0")}`;
    const context: JourneyExecutionContext = {
      runId,
      executionId,
      profile,
      plan: options.plan,
      evidence,
      observers
    };

    const execution = await runProfileExecution({
      adapter: options.adapter,
      context,
      evidence,
      observers,
      plan: options.plan,
      profile
    });

    executions.push(execution);
    if (execution.error) errors.push(execution.error);
  }

  let ok = executions.every((execution) => execution.ok);
  let result = buildResult({
    errors,
    events: evidence.snapshot(),
    executions,
    ok,
    plan: options.plan,
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
      errors,
      events: evidence.snapshot(),
      executions,
      ok,
      plan: options.plan,
      runId
    });
  }

  const runCompletionError = await notifyRunCompleted({
    evidence,
    observers,
    result
  });
  if (runCompletionError) {
    ok = false;
    errors.push(runCompletionError);
    result = buildResult({
      errors,
      events: evidence.snapshot(),
      executions,
      ok,
      plan: options.plan,
      runId
    });
  }

  evidence.emit({
    type: "runner.run.completed",
    ok,
    references: referencesForPlan(options.plan),
    data: {
      planId: options.plan.id,
      executionCount: executions.length,
      errorCount: errors.length
    }
  });

  return buildResult({
    errors,
    events: evidence.snapshot(),
    executions,
    ok,
    plan: options.plan,
    runId
  });
}

async function runProfileExecution({
  adapter,
  context,
  evidence,
  observers,
  plan,
  profile
}: {
  adapter: JourneyAdapter;
  context: JourneyExecutionContext;
  evidence: EvidenceRecorder;
  observers: readonly JourneyObserver[];
  plan: JourneyPlan;
  profile: JourneyProfile;
}): Promise<ExecutionResult> {
  let ok = true;
  let executionError: EvidenceError | undefined;
  const currentEntryByActor = new Map<string, string>();
  let adapterExecution: JourneyAdapterExecution | undefined;

  evidence.emit({
    type: "profile.execution.started",
    executionId: context.executionId,
    profileId: profile.id,
    ok: true,
    references: referencesForPlan(plan),
    data: { label: profile.label ?? profile.id }
  });

  try {
    await notifyExecutionStarted({ context, evidence, observers });

    evidence.emit({
      type: "adapter.setup.started",
      executionId: context.executionId,
      profileId: profile.id,
      ok: true,
      data: componentData(adapter)
    });
    adapterExecution = adapter.createExecution(context);
    await adapterExecution.start();
    evidence.emit({
      type: "adapter.setup.completed",
      executionId: context.executionId,
      profileId: profile.id,
      ok: true,
      data: componentData(adapter)
    });

    for (const operation of plan.operations) {
      evidence.emit(operationEvent(operation, context, "operation.started", true));
      await ensureEntryOpen({ adapterExecution, context, currentEntryByActor, evidence, operation });

      if (operation.kind === "state") {
        await assertState({ adapterExecution, context, evidence, operation });
      } else if (operation.kind === "transition") {
        await performTransition({ adapterExecution, context, evidence, operation, profile });
      } else {
        await recordControlFlow({ adapterExecution, context, evidence, operation });
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
    if (adapterExecution) {
      try {
        evidence.emit({
          type: "adapter.teardown.started",
          executionId: context.executionId,
          profileId: profile.id,
          ok: true,
          data: componentData(adapter)
        });
        await adapterExecution.close({ executionFailed: !ok });
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
  }

  const executionBeforeObserver = {
    executionId: context.executionId,
    profileId: profile.id,
    ok,
    error: executionError
  };
  const observerCompletionError = await notifyExecutionCompleted({
    context,
    evidence,
    execution: executionBeforeObserver,
    observers
  });
  if (observerCompletionError) {
    ok = false;
    executionError = observerCompletionError;
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
  adapterExecution,
  context,
  currentEntryByActor,
  evidence,
  operation
}: {
  adapterExecution: JourneyAdapterExecution;
  context: JourneyExecutionContext;
  currentEntryByActor: Map<string, string>;
  evidence: EvidenceRecorder;
  operation: JourneyPlanOperation;
}): Promise<void> {
  if (!operation.entryBinding) return;

  const entryKey = `${operation.entry.id}\u0000${operation.entryBinding.id}\u0000${operation.entryBinding.value}`;
  if (currentEntryByActor.get(operation.actorId) === entryKey) return;

  evidence.emit(operationEvent(operation, context, "adapter.open-entry.started", true, {
    entryBindingValue: operation.entryBinding.value
  }));
  await adapterExecution.openEntry(operation);
  currentEntryByActor.set(operation.actorId, entryKey);
  evidence.emit(operationEvent(operation, context, "adapter.open-entry.completed", true, {
    entryBindingValue: operation.entryBinding.value
  }));
}

async function assertState({
  adapterExecution,
  context,
  evidence,
  operation
}: {
  adapterExecution: JourneyAdapterExecution;
  context: JourneyExecutionContext;
  evidence: EvidenceRecorder;
  operation: StatePlanOperation;
}): Promise<void> {
  evidence.emit(operationEvent(operation, context, "adapter.assert-state.started", true, {
    expectedMatchCount: operation.target.expectedMatchCount
  }));
  await adapterExecution.assertState(operation);
  evidence.emit(operationEvent(operation, context, "adapter.assert-state.completed", true, {
    expectedMatchCount: operation.target.expectedMatchCount
  }));
}

async function performTransition({
  adapterExecution,
  context,
  evidence,
  operation,
  profile
}: {
  adapterExecution: JourneyAdapterExecution;
  context: JourneyExecutionContext;
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
  await adapterExecution.performTransition(operation, decision);
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
  adapterExecution,
  context,
  evidence,
  operation
}: {
  adapterExecution: JourneyAdapterExecution;
  context: JourneyExecutionContext;
  evidence: EvidenceRecorder;
  operation: ControlFlowPlanOperation;
}): Promise<void> {
  evidence.emit(operationEvent(operation, context, "adapter.control-flow.started", true));
  await adapterExecution.recordControlFlow(operation);
  evidence.emit(operationEvent(operation, context, "adapter.control-flow.completed", true));
}

async function notifyRunStarted({
  adapter,
  evidence,
  observers,
  plan,
  profiles,
  runId
}: {
  adapter: JourneyAdapter;
  evidence: EvidenceRecorder;
  observers: readonly JourneyObserver[];
  plan: JourneyPlan;
  profiles: readonly JourneyProfile[];
  runId: string;
}): Promise<EvidenceError | undefined> {
  for (const observer of observers) {
    if (!observer.onRunStarted) continue;

    try {
      evidence.emit({
        type: "observer.run-started.started",
        ok: true,
        data: componentData(observer)
      });
      await observer.onRunStarted({ adapter, evidence, plan, profiles, runId });
      evidence.emit({
        type: "observer.run-started.completed",
        ok: true,
        data: componentData(observer)
      });
    } catch (error) {
      const evidenceError = errorToEvidence(error);
      evidence.emit({
        type: "observer.run-started.failed",
        ok: false,
        data: componentData(observer),
        error: evidenceError
      });
      return evidenceError;
    }
  }

  return undefined;
}

async function notifyRunCompleted({
  evidence,
  observers,
  result
}: {
  evidence: EvidenceRecorder;
  observers: readonly JourneyObserver[];
  result: RunResult;
}): Promise<EvidenceError | undefined> {
  for (const observer of observers) {
    if (!observer.onRunCompleted) continue;

    try {
      evidence.emit({
        type: "observer.run-completed.started",
        ok: true,
        data: componentData(observer)
      });
      await observer.onRunCompleted({ evidence, result });
      evidence.emit({
        type: "observer.run-completed.completed",
        ok: true,
        data: componentData(observer)
      });
    } catch (error) {
      const evidenceError = errorToEvidence(error);
      evidence.emit({
        type: "observer.run-completed.failed",
        ok: false,
        data: componentData(observer),
        error: evidenceError
      });
      return evidenceError;
    }
  }

  return undefined;
}

async function notifyExecutionStarted({
  context,
  evidence,
  observers
}: {
  context: JourneyExecutionContext;
  evidence: EvidenceRecorder;
  observers: readonly JourneyObserver[];
}): Promise<void> {
  for (const observer of observers) {
    if (!observer.onExecutionStarted) continue;

    try {
      evidence.emit({
        type: "observer.execution-started.started",
        executionId: context.executionId,
        profileId: context.profile.id,
        ok: true,
        data: componentData(observer)
      });
      await observer.onExecutionStarted({ context });
      evidence.emit({
        type: "observer.execution-started.completed",
        executionId: context.executionId,
        profileId: context.profile.id,
        ok: true,
        data: componentData(observer)
      });
    } catch (error) {
      const evidenceError = errorToEvidence(error);
      evidence.emit({
        type: "observer.execution-started.failed",
        executionId: context.executionId,
        profileId: context.profile.id,
        ok: false,
        data: componentData(observer),
        error: evidenceError
      });
      throw error;
    }
  }
}

async function notifyExecutionCompleted({
  context,
  evidence,
  execution,
  observers
}: {
  context: JourneyExecutionContext;
  evidence: EvidenceRecorder;
  execution: ExecutionResult;
  observers: readonly JourneyObserver[];
}): Promise<EvidenceError | undefined> {
  for (const observer of observers) {
    if (!observer.onExecutionCompleted) continue;

    try {
      evidence.emit({
        type: "observer.execution-completed.started",
        executionId: context.executionId,
        profileId: context.profile.id,
        ok: true,
        data: componentData(observer)
      });
      await observer.onExecutionCompleted({ context, execution });
      evidence.emit({
        type: "observer.execution-completed.completed",
        executionId: context.executionId,
        profileId: context.profile.id,
        ok: true,
        data: componentData(observer)
      });
    } catch (error) {
      const evidenceError = errorToEvidence(error);
      evidence.emit({
        type: "observer.execution-completed.failed",
        executionId: context.executionId,
        profileId: context.profile.id,
        ok: false,
        data: componentData(observer),
        error: evidenceError
      });
      return evidenceError;
    }
  }

  return undefined;
}

function operationEvent(
  operation: JourneyPlanOperation,
  context: JourneyExecutionContext,
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
    references: referencesForOperation(context.plan, operation),
    data
  };
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
  errors,
  events,
  executions,
  ok,
  plan,
  runId
}: {
  errors: EvidenceError[];
  events: EvidenceEvent[];
  executions: ExecutionResult[];
  ok: boolean;
  plan: JourneyPlan;
  runId: string;
}): RunResult {
  return {
    ok,
    runId,
    plan: {
      id: plan.id,
      ...(plan.source ? { source: plan.source } : {})
    },
    executions: [...executions],
    evidence: { events },
    errors: [...errors]
  };
}
