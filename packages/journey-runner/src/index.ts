import type {
  ControlFlowPlanOperation,
  InputModalityDecision,
  JourneyPlan,
  JourneyPlanOperation,
  JourneyPlanOperationKind,
  JourneyPlanSource,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";
import {
  errorToJourneyRunError,
  type JourneyRunError
} from "./errors.js";
import {
  componentDescriptor,
  executionDescriptor,
  profileDescriptor
} from "./observers/contracts.js";
import { JourneyObserverDispatcher } from "./observers/journey-observer-dispatcher.js";
import type { JourneyObserver } from "./observers/contracts.js";
import { ReporterPipeline } from "./reporters/reporter-pipeline.js";

export {
  componentDescriptor,
  executionDescriptor,
  profileDescriptor
} from "./observers/contracts.js";
export { errorToJourneyRunError } from "./errors.js";

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
export type { JourneyRunError } from "./errors.js";

export type {
  JourneyComponentDescriptor,
  JourneyExecutionDescriptor,
  JourneyObserver,
  JourneyObserverExecutionCompletedInput,
  JourneyObserverExecutionStartedInput,
  JourneyObserverRunCompletedInput,
  JourneyObserverRunStartedInput,
  JourneyProfileDescriptor
} from "./observers/contracts.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JourneyExecutionContext = {
  readonly runId: string;
  readonly executionId: string;
  readonly profile: JourneyProfile;
  readonly plan: JourneyPlan;
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

export type JourneyReporterInput = {
  readonly result: RunResult;
  readonly json: string;
};

export type JourneyReporter = {
  name: string;
  version?: string;
  report(input: JourneyReporterInput): Promise<void> | void;
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
  error?: JourneyRunError;
};

export type JourneyOperationEvidence = {
  operationId: string;
  operationKind: JourneyPlanOperationKind;
  ok: boolean;
  error?: JourneyRunError;
};

export type JourneyExecutionEvidence = {
  executionId: string;
  profileId: string;
  operations: JourneyOperationEvidence[];
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
    executions: JourneyExecutionEvidence[];
  };
  errors: JourneyRunError[];
};

type ProfileExecutionOutcome = {
  readonly execution: ExecutionResult;
  readonly evidence: JourneyExecutionEvidence;
};

export async function runJourney(options: RunJourneyOptions): Promise<RunResult> {
  if (options.profiles.length === 0) {
    throw new Error("runJourney requires at least one profile");
  }

  const runId = options.runId ?? `run-${new Date().toISOString()}`;
  const executions: ExecutionResult[] = [];
  const evidenceExecutions: JourneyExecutionEvidence[] = [];
  const errors: JourneyRunError[] = [];
  const observers = options.observers ?? [];
  const observerDispatcher = new JourneyObserverDispatcher(observers);

  const runStartError = await observerDispatcher.runStarted({
    adapter: componentDescriptor(options.adapter),
    plan: options.plan,
    profiles: options.profiles.map(profileDescriptor),
    runId
  });
  if (runStartError) {
    errors.push(runStartError);
    return buildResult({
      errors,
      evidenceExecutions,
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
      plan: options.plan
    };
    const descriptor = executionDescriptor(context);

    const outcome = await runProfileExecution({
      adapter: options.adapter,
      context,
      descriptor,
      observerDispatcher,
      plan: options.plan,
      profile
    });

    executions.push(outcome.execution);
    evidenceExecutions.push(outcome.evidence);
    if (outcome.execution.error) errors.push(outcome.execution.error);
  }

  let ok = executions.every((execution) => execution.ok);
  let result = buildResult({
    errors,
    evidenceExecutions,
    executions,
    ok,
    plan: options.plan,
    runId
  });

  const reporterPipeline = new ReporterPipeline();
  const reporterOutcome = await reporterPipeline.run({
    reporters: options.reporters ?? [],
    result
  });
  if (reporterOutcome.errors.length > 0) {
    ok = false;
    errors.push(...reporterOutcome.errors);
    result = buildResult({
      errors,
      evidenceExecutions,
      executions,
      ok,
      plan: options.plan,
      runId
    });
  }

  const runCompletionError = await observerDispatcher.runCompleted(result);
  if (runCompletionError) {
    ok = false;
    errors.push(runCompletionError);
    result = buildResult({
      errors,
      evidenceExecutions,
      executions,
      ok,
      plan: options.plan,
      runId
    });
  }

  return result;
}

async function runProfileExecution({
  adapter,
  context,
  descriptor,
  observerDispatcher,
  plan,
  profile
}: {
  adapter: JourneyAdapter;
  context: JourneyExecutionContext;
  descriptor: ReturnType<typeof executionDescriptor>;
  observerDispatcher: JourneyObserverDispatcher;
  plan: JourneyPlan;
  profile: JourneyProfile;
}): Promise<ProfileExecutionOutcome> {
  let ok = true;
  let executionError: JourneyRunError | undefined;
  const currentEntryByActor = new Map<string, string>();
  let adapterExecution: JourneyAdapterExecution | undefined;
  const operations: JourneyOperationEvidence[] = [];

  try {
    await observerDispatcher.executionStarted(descriptor);

    adapterExecution = adapter.createExecution({ context });
    await adapterExecution.start();

    for (const operation of plan.operations) {
      try {
        await executeOperation({
          adapterExecution,
          context,
          currentEntryByActor,
          operation,
          profile
        });
        operations.push(operationEvidence(operation, true));
      } catch (error) {
        const operationError = errorToJourneyRunError(error);
        operations.push(operationEvidence(operation, false, operationError));
        throw operationError;
      }
    }
  } catch (error) {
    ok = false;
    executionError = errorToJourneyRunError(error);
  } finally {
    if (adapterExecution) {
      try {
        await adapterExecution.close({ executionFailed: !ok });
      } catch (error) {
        ok = false;
        executionError = errorToJourneyRunError(error);
      }
    }
  }

  const executionBeforeObserver: ExecutionResult = {
    executionId: context.executionId,
    profileId: profile.id,
    ok,
    error: executionError
  };
  const observerCompletionError = await notifyExecutionCompleted({
    descriptor,
    execution: executionBeforeObserver,
    observerDispatcher
  });
  if (observerCompletionError) {
    ok = false;
    executionError = observerCompletionError;
  }

  return {
    execution: {
      executionId: context.executionId,
      profileId: profile.id,
      ok,
      error: executionError
    },
    evidence: {
      executionId: context.executionId,
      profileId: profile.id,
      operations
    }
  };
}

async function executeOperation({
  adapterExecution,
  context,
  currentEntryByActor,
  operation,
  profile
}: {
  adapterExecution: JourneyAdapterExecution;
  context: JourneyExecutionContext;
  currentEntryByActor: Map<string, string>;
  operation: JourneyPlanOperation;
  profile: JourneyProfile;
}): Promise<void> {
  await ensureEntryOpen({
    adapterExecution,
    currentEntryByActor,
    operation
  });

  if (operation.kind === "state") {
    await adapterExecution.assertState(operation);
  } else if (operation.kind === "transition") {
    const decision = await profile.selectInputModality(operation, context);
    await adapterExecution.performTransition(operation, decision);
  } else {
    await adapterExecution.recordControlFlow(operation);
  }
}

async function ensureEntryOpen({
  adapterExecution,
  currentEntryByActor,
  operation
}: {
  adapterExecution: JourneyAdapterExecution;
  currentEntryByActor: Map<string, string>;
  operation: JourneyPlanOperation;
}): Promise<void> {
  if (!operation.entryBinding) return;

  const entryKey = `${operation.entry.id}\u0000${operation.entryBinding.id}\u0000${operation.entryBinding.value}`;
  if (currentEntryByActor.get(operation.actorId) === entryKey) return;

  await adapterExecution.openEntry(operation);
  currentEntryByActor.set(operation.actorId, entryKey);
}

async function notifyExecutionCompleted({
  descriptor,
  execution,
  observerDispatcher
}: {
  descriptor: ReturnType<typeof executionDescriptor>;
  execution: ExecutionResult;
  observerDispatcher: JourneyObserverDispatcher;
}): Promise<JourneyRunError | undefined> {
  return observerDispatcher.executionCompleted(descriptor, execution);
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function operationEvidence(
  operation: JourneyPlanOperation,
  ok: boolean,
  error?: JourneyRunError
): JourneyOperationEvidence {
  return {
    operationId: operation.id,
    operationKind: operation.kind,
    ok,
    ...(error ? { error } : {})
  };
}

function buildResult({
  errors,
  evidenceExecutions,
  executions,
  ok,
  plan,
  runId
}: {
  errors: readonly JourneyRunError[];
  evidenceExecutions: readonly JourneyExecutionEvidence[];
  executions: readonly ExecutionResult[];
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
    executions: executions.map((execution) => ({ ...execution })),
    evidence: {
      executions: evidenceExecutions.map((execution) => ({
        executionId: execution.executionId,
        profileId: execution.profileId,
        operations: execution.operations.map((operation) => ({ ...operation }))
      }))
    },
    errors: errors.map((error) => ({ ...error }))
  };
}
