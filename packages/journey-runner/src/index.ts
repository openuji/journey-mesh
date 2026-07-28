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
  scopeEvidenceToExecution,
  type EvidenceError,
  type EvidenceEvent,
  type ExecutionEvidenceSink
} from "@openuji/journey-evidence";
import { ExecutionEvidence } from "./evidence/execution-evidence.js";
import { RunEvidence } from "./evidence/run-evidence.js";

export {
  EvidenceRecorder,
  errorToEvidence,
  referencesForPlan,
  scopeEvidenceToExecution
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
  EvidenceLog,
  EvidenceSink,
  EvidenceComponent,
  ExecutionEvidenceIdentity,
  ExecutionEvidenceSink,
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
  createExecution(input: JourneyAdapterExecutionInput): JourneyAdapterExecution;
};

export type JourneyAdapterExecutionInput = {
  readonly context: JourneyExecutionContext;
  readonly evidence: ExecutionEvidenceSink;
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
};

export type JourneyObserverRunCompletedInput = {
  result: RunResult;
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
  const runEvidence = new RunEvidence(evidence);
  const executions: ExecutionResult[] = [];
  const errors: EvidenceError[] = [];
  const observers = options.observers ?? [];

  runEvidence.runStarted({
    plan: options.plan,
    profiles: options.profiles,
    adapter: options.adapter,
    observers,
    reporters: options.reporters ?? []
  });

  const runStartError = await notifyRunStarted({
    adapter: options.adapter,
    observers,
    plan: options.plan,
    profiles: options.profiles,
    runEvidence,
    runId
  });
  if (runStartError) {
    errors.push(runStartError);
    runEvidence.runCompleted({
      plan: options.plan,
      ok: false,
      executionCount: 0,
      errorCount: errors.length
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
      observers
    };
    const executionSink = scopeEvidenceToExecution(evidence, {
      executionId,
      profileId: profile.id
    });
    const executionEvidence = new ExecutionEvidence(context, executionSink);

    const execution = await runProfileExecution({
      adapter: options.adapter,
      context,
      executionEvidence,
      executionSink,
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
      runEvidence.reporterStarted(reporter);
      await reporter.report(result);
      runEvidence.reporterCompleted(reporter);
    } catch (error) {
      ok = false;
      const evidenceError = errorToEvidence(error);
      errors.push(evidenceError);
      runEvidence.reporterFailed(reporter, evidenceError);
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
    observers,
    result,
    runEvidence
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

  runEvidence.runCompleted({
    plan: options.plan,
    ok,
    executionCount: executions.length,
    errorCount: errors.length
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
  executionEvidence,
  executionSink,
  plan,
  profile
}: {
  adapter: JourneyAdapter;
  context: JourneyExecutionContext;
  executionEvidence: ExecutionEvidence;
  executionSink: ExecutionEvidenceSink;
  plan: JourneyPlan;
  profile: JourneyProfile;
}): Promise<ExecutionResult> {
  let ok = true;
  let executionError: EvidenceError | undefined;
  const currentEntryByActor = new Map<string, string>();
  let adapterExecution: JourneyAdapterExecution | undefined;

  executionEvidence.executionStarted();

  try {
    await notifyExecutionStarted({ context, executionEvidence });

    executionEvidence.adapterStartStarted(adapter);
    adapterExecution = adapter.createExecution({
      context,
      evidence: executionSink
    });
    await adapterExecution.start();
    executionEvidence.adapterStartCompleted(adapter);

    for (const operation of plan.operations) {
      executionEvidence.operationStarted(operation);
      await ensureEntryOpen({
        adapterExecution,
        currentEntryByActor,
        executionEvidence,
        operation
      });

      if (operation.kind === "state") {
        await assertState({ adapterExecution, executionEvidence, operation });
      } else if (operation.kind === "transition") {
        await performTransition({ adapterExecution, context, executionEvidence, operation, profile });
      } else {
        await recordControlFlow({ adapterExecution, executionEvidence, operation });
      }

      executionEvidence.operationCompleted(operation);
    }
  } catch (error) {
    ok = false;
    executionError = errorToEvidence(error);
    executionEvidence.executionFailed(executionError);
  } finally {
    if (adapterExecution) {
      try {
        executionEvidence.adapterCloseStarted(adapter);
        await adapterExecution.close({ executionFailed: !ok });
        executionEvidence.adapterCloseCompleted(adapter);
      } catch (error) {
        ok = false;
        executionError = errorToEvidence(error);
        executionEvidence.adapterCloseFailed(adapter, executionError);
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
    executionEvidence,
    execution: executionBeforeObserver,
  });
  if (observerCompletionError) {
    ok = false;
    executionError = observerCompletionError;
  }

  executionEvidence.executionCompleted({
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
  currentEntryByActor,
  executionEvidence,
  operation
}: {
  adapterExecution: JourneyAdapterExecution;
  currentEntryByActor: Map<string, string>;
  executionEvidence: ExecutionEvidence;
  operation: JourneyPlanOperation;
}): Promise<void> {
  if (!operation.entryBinding) return;

  const entryKey = `${operation.entry.id}\u0000${operation.entryBinding.id}\u0000${operation.entryBinding.value}`;
  if (currentEntryByActor.get(operation.actorId) === entryKey) return;

  executionEvidence.openEntryStarted(operation);
  await adapterExecution.openEntry(operation);
  currentEntryByActor.set(operation.actorId, entryKey);
  executionEvidence.openEntryCompleted(operation);
}

async function assertState({
  adapterExecution,
  executionEvidence,
  operation
}: {
  adapterExecution: JourneyAdapterExecution;
  executionEvidence: ExecutionEvidence;
  operation: StatePlanOperation;
}): Promise<void> {
  executionEvidence.stateAssertionStarted(operation);
  await adapterExecution.assertState(operation);
  executionEvidence.stateAssertionCompleted(operation);
}

async function performTransition({
  adapterExecution,
  context,
  executionEvidence,
  operation,
  profile
}: {
  adapterExecution: JourneyAdapterExecution;
  context: JourneyExecutionContext;
  executionEvidence: ExecutionEvidence;
  operation: TransitionPlanOperation;
  profile: JourneyProfile;
}): Promise<void> {
  const decision = await profile.selectInputModality(operation, context);

  executionEvidence.modalitySelected(operation, decision);

  executionEvidence.transitionStarted(operation, decision);
  await adapterExecution.performTransition(operation, decision);
  executionEvidence.transitionCompleted(operation, decision);

  for (const effect of operation.effects) {
    executionEvidence.effectRecorded(operation, effect);
  }
}

async function recordControlFlow({
  adapterExecution,
  executionEvidence,
  operation
}: {
  adapterExecution: JourneyAdapterExecution;
  executionEvidence: ExecutionEvidence;
  operation: ControlFlowPlanOperation;
}): Promise<void> {
  executionEvidence.controlFlowStarted(operation);
  await adapterExecution.recordControlFlow(operation);
  executionEvidence.controlFlowCompleted(operation);
}

async function notifyRunStarted({
  adapter,
  observers,
  plan,
  profiles,
  runEvidence,
  runId
}: {
  adapter: JourneyAdapter;
  observers: readonly JourneyObserver[];
  plan: JourneyPlan;
  profiles: readonly JourneyProfile[];
  runEvidence: RunEvidence;
  runId: string;
}): Promise<EvidenceError | undefined> {
  for (const observer of observers) {
    if (!observer.onRunStarted) continue;

    try {
      runEvidence.observerRunStarted(observer);
      await observer.onRunStarted({ adapter, plan, profiles, runId });
      runEvidence.observerRunStartCompleted(observer);
    } catch (error) {
      const evidenceError = errorToEvidence(error);
      runEvidence.observerRunStartFailed(observer, evidenceError);
      return evidenceError;
    }
  }

  return undefined;
}

async function notifyRunCompleted({
  observers,
  result,
  runEvidence
}: {
  observers: readonly JourneyObserver[];
  result: RunResult;
  runEvidence: RunEvidence;
}): Promise<EvidenceError | undefined> {
  for (const observer of observers) {
    if (!observer.onRunCompleted) continue;

    try {
      runEvidence.observerRunCompleted(observer);
      await observer.onRunCompleted({ result });
      runEvidence.observerRunCompletionCompleted(observer);
    } catch (error) {
      const evidenceError = errorToEvidence(error);
      runEvidence.observerRunCompletionFailed(observer, evidenceError);
      return evidenceError;
    }
  }

  return undefined;
}

async function notifyExecutionStarted({
  context,
  executionEvidence
}: {
  context: JourneyExecutionContext;
  executionEvidence: ExecutionEvidence;
}): Promise<void> {
  for (const observer of context.observers) {
    if (!observer.onExecutionStarted) continue;

    try {
      executionEvidence.observerExecutionStarted(observer);
      await observer.onExecutionStarted({ context });
      executionEvidence.observerExecutionStartCompleted(observer);
    } catch (error) {
      executionEvidence.observerExecutionStartFailed(observer, error);
      throw error;
    }
  }
}

async function notifyExecutionCompleted({
  context,
  executionEvidence,
  execution
}: {
  context: JourneyExecutionContext;
  executionEvidence: ExecutionEvidence;
  execution: ExecutionResult;
}): Promise<EvidenceError | undefined> {
  for (const observer of context.observers) {
    if (!observer.onExecutionCompleted) continue;

    try {
      executionEvidence.observerExecutionCompleted(observer);
      await observer.onExecutionCompleted({ context, execution });
      executionEvidence.observerExecutionCompletionCompleted(observer);
    } catch (error) {
      const evidenceError = errorToEvidence(error);
      executionEvidence.observerExecutionCompletionFailed(observer, evidenceError);
      return evidenceError;
    }
  }

  return undefined;
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
  events: readonly EvidenceEvent[];
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
    evidence: { events: [...events] },
    errors: [...errors]
  };
}
