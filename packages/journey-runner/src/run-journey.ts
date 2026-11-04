import type {
  InputModalityDecision,
  JourneyPlan,
  JourneyPlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";

import type {
  JourneyAdapter,
  JourneyAdapterExecution,
  JourneyExecutionContext,
  JourneyProfile
} from "./adapters/contracts.js";
import type { JourneyEnvironment } from "./environment/contracts.js";
import { errorToJourneyRunError } from "./errors.js";
import { componentDescriptor, executionDescriptor, profileDescriptor } from "./observers/contracts.js";
import type { JourneyComponentDescriptor, JourneyExecutionDescriptor, JourneyObserver } from "./observers/contracts.js";
import { JourneyObserverDispatcher } from "./observers/journey-observer-dispatcher.js";
import type { JourneyProgressSink } from "./progress/contracts.js";
import { JourneyProgressDispatcher } from "./progress/progress-dispatcher.js";
import { assessProfiles } from "./profiles/assess-profiles.js";
import { buildResult } from "./results/build-result.js";
import type {
  ExecutionResult,
  JourneyExecutionEvidence,
  JourneyOperationEvidence,
  JourneyOutcome,
  RunResult
} from "./results/contracts.js";
import { combineOutcomes, failedOutcome, passedOutcome } from "./results/outcomes.js";

export type RunJourneyOptions = {
  plan: JourneyPlan;
  adapter: JourneyAdapter;
  profiles: readonly JourneyProfile[];
  environment?: JourneyEnvironment;
  observers?: readonly JourneyObserver[];
  progress?: readonly JourneyProgressSink[];
  runId?: string;
  signal?: AbortSignal;
};

type ProfileExecutionOutcome = Readonly<{
  execution: ExecutionResult;
  evidence: JourneyExecutionEvidence;
}>;

type ExecutionBatch = Readonly<{
  outcome: JourneyOutcome;
  operations: readonly JourneyOperationEvidence[];
}>;

type EntryMap = ReadonlyMap<string, string>;

type OperationFold = ExecutionBatch & Readonly<{ entries: EntryMap }>;

type ProfileExecutionInput = Readonly<{
  adapter: JourneyAdapter;
  context: JourneyExecutionContext;
  environment?: JourneyEnvironment;
  observerDispatcher: JourneyObserverDispatcher;
  progress: JourneyProgressDispatcher;
}>;

export async function runJourney(options: RunJourneyOptions): Promise<RunResult> {
  if (options.profiles.length === 0) throw new Error("runJourney requires at least one profile");

  const runId = options.runId ?? `run-${new Date().toISOString()}`;
  const observerDispatcher = new JourneyObserverDispatcher(options.observers ?? []);
  const progress = new JourneyProgressDispatcher(options.progress ?? []);

  await progress.publish({
    type: "run-started",
    runId,
    planId: options.plan.id,
    profileCount: options.profiles.length,
    operationsPerProfile: options.plan.operations.length
  });
  const runStartedAt = performance.now();

  const candidates = await assessProfiles(options.profiles.map((profile, profileIndex) => Object.freeze({
    runId,
    executionId: `${safeSegment(profile.id)}-${String(profileIndex + 1).padStart(2, "0")}`,
    profile,
    plan: options.plan,
    signal: options.signal
  })));
  const assessments = Object.freeze(candidates.map((candidate) => candidate.assessment));
  await progress.publish({ type: "profiles-assessed", runId, assessments });

  const runStartError = await observerDispatcher.runStarted({
    adapter: componentDescriptor(options.adapter),
    plan: options.plan,
    profiles: Object.freeze(options.profiles.map(profileDescriptor)),
    assessments,
    runId
  });
  const outcomes = runStartError ? Object.freeze([]) :
    await candidates.reduce<Promise<readonly ProfileExecutionOutcome[]>>(async (pending, candidate) => {
      const previous = await pending;
      if (candidate.assessment.kind !== "applicable") return previous;
      const outcome = await runProfileExecution({
        adapter: options.adapter,
        context: candidate.context,
        environment: options.environment,
        observerDispatcher,
        progress
      });
      return Object.freeze([...previous, outcome]);
    }, Promise.resolve(Object.freeze([])));

  const completed = {
    assessments,
    evidenceExecutions: outcomes.map((outcome) => outcome.evidence),
    executions: outcomes.map((outcome) => outcome.execution),
    plan: options.plan,
    runId,
    runErrors: runStartError ? [runStartError] : []
  };
  const resultBeforeRunCompletion = buildResult(completed);
  const completionError = await observerDispatcher.runCompleted(resultBeforeRunCompletion);
  const finalResult = completionError
    ? buildResult({ ...completed, runErrors: [...completed.runErrors, completionError] })
    : resultBeforeRunCompletion;

  await progress.publish({
    type: "run-completed",
    runId,
    ok: finalResult.ok,
    durationMs: performance.now() - runStartedAt
  });
  return finalResult;
}

async function runProfileExecution(input: ProfileExecutionInput): Promise<ProfileExecutionOutcome> {
  const { context, observerDispatcher, progress } = input;
  const descriptor = executionDescriptor(context);
  await progress.publish({
    type: "execution-started",
    runId: context.runId,
    executionId: context.executionId,
    profileId: context.profile.id
  });
  const executionStartedAt = performance.now();
  const batch = await runProfileBody(input, descriptor);
  const beforeObserver = executionResult(context, batch.outcome);
  const completionError = await observerDispatcher.executionCompleted(descriptor, beforeObserver);
  const execution = completionError
    ? executionResult(context, combineOutcomes(batch.outcome, failedOutcome(completionError), "execution observer"))
    : beforeObserver;

  await progress.publish({
    type: "execution-completed",
    result: execution,
    durationMs: performance.now() - executionStartedAt
  });
  return Object.freeze({
    execution,
    evidence: Object.freeze({
      executionId: context.executionId,
      profileId: context.profile.id,
      operations: batch.operations
    })
  });
}

async function runProfileBody(
  input: ProfileExecutionInput,
  descriptor: JourneyExecutionDescriptor
): Promise<ExecutionBatch> {
  try {
    input.context.signal?.throwIfAborted();
    await input.observerDispatcher.executionStarted(descriptor);
    // Routing is resolved before shared fixture setup can change service state.
    const adapters = new Map(input.context.plan.operations.map((operation) => [
      operation,
      Object.freeze(componentDescriptor(input.adapter.describeOperation?.(operation) ?? input.adapter))
    ]));
    return await withEnvironment(input.context, input.environment, () => withAdapter(input, adapters));
  } catch (error) {
    return emptyBatch(failedOutcome(error));
  }
}

async function withEnvironment(
  context: JourneyExecutionContext,
  environment: JourneyEnvironment | undefined,
  execute: () => Promise<ExecutionBatch>
): Promise<ExecutionBatch> {
  if (!environment) return attemptBatch(execute);
  const setup = await attempt(async () => {
    context.signal?.throwIfAborted();
    await environment.setup?.(context);
    context.signal?.throwIfAborted();
  });
  const batch = setup.kind === "failed" ? emptyBatch(setup) : await attemptBatch(execute);
  const cleanup = await attempt(() => environment.teardown?.({
    context,
    executionFailed: batch.outcome.kind === "failed"
  }));
  return Object.freeze({ ...batch, outcome: combineOutcomes(batch.outcome, cleanup, "cleanup") });
}

async function withAdapter(
  input: ProfileExecutionInput,
  adapters: ReadonlyMap<JourneyPlanOperation, JourneyComponentDescriptor>
): Promise<ExecutionBatch> {
  try {
    const execution = input.adapter.createExecution({ context: input.context });
    // Closing on cancellation also interrupts pending browser/device commands.
    let closing: Promise<void> | undefined;
    const close = (executionFailed: boolean) => closing ??= Promise.resolve().then(() => execution.close({ executionFailed }));
    const onAbort = () => { void close(true).catch(() => {}); };
    input.context.signal?.addEventListener("abort", onAbort, { once: true });
    const startup = await attempt(() => abortable(() => execution.start(), input.context.signal));
    const batch = startup.kind === "failed" ? emptyBatch(startup) :
      await attemptBatch(() => runOperations(input, execution, adapters));
    input.context.signal?.removeEventListener("abort", onAbort);
    const cleanup = await attempt(() => close(batch.outcome.kind === "failed"));
    return Object.freeze({ ...batch, outcome: combineOutcomes(batch.outcome, cleanup, "cleanup") });
  } catch (error) {
    // createExecution failed before returning a handle that could be closed.
    return emptyBatch(failedOutcome(error));
  }
}

async function runOperations(
  input: ProfileExecutionInput,
  adapterExecution: JourneyAdapterExecution,
  adapters: ReadonlyMap<JourneyPlanOperation, JourneyComponentDescriptor>
): Promise<ExecutionBatch> {
  const { context, progress } = input;
  const completed = await context.plan.operations.reduce<Promise<OperationFold>>(async (pending, operation, index) => {
    const previous = await pending;
    if (previous.outcome.kind === "failed") return previous;
    const operationProgress = {
      executionId: context.executionId,
      profileId: context.profile.id,
      operation,
      position: index + 1,
      total: context.plan.operations.length
    };
    await progress.publish({ type: "operation-started", ...operationProgress });
    const startedAt = performance.now();
    try {
      const entries = await abortable(() => executeOperation(input, adapterExecution, previous.entries, operation), context.signal);
      await progress.publish({
        type: "operation-completed", ...operationProgress, durationMs: performance.now() - startedAt
      });
      return Object.freeze({
        entries,
        outcome: passedOutcome,
        operations: Object.freeze([...previous.operations, operationEvidence(operation, adapters.get(operation)!, passedOutcome)])
      });
    } catch (error) {
      const outcome = failedOutcome(error);
      await progress.publish({
        type: "operation-failed", ...operationProgress,
        durationMs: performance.now() - startedAt,
        error: errorToJourneyRunError(error)
      });
      return Object.freeze({
        entries: previous.entries,
        outcome,
        operations: Object.freeze([...previous.operations, operationEvidence(operation, adapters.get(operation)!, outcome)])
      });
    }
  }, Promise.resolve(Object.freeze({ ...emptyBatch(passedOutcome), entries: new Map<string, string>() })));
  return Object.freeze({ outcome: completed.outcome, operations: completed.operations });
}

async function executeOperation(
  input: ProfileExecutionInput,
  adapterExecution: JourneyAdapterExecution,
  currentEntries: EntryMap,
  operation: JourneyPlanOperation
): Promise<EntryMap> {
  input.context.signal?.throwIfAborted();
  const entries = await ensureEntryOpen(adapterExecution, currentEntries, operation);
  input.context.signal?.throwIfAborted();
  if (operation.kind === "state") {
    await adapterExecution.assertState(operation);
  } else if (operation.kind === "transition") {
    const decision = await selectInputModality(operation, input.context);
    await adapterExecution.performTransition(operation, decision);
    input.context.signal?.throwIfAborted();
    for (const effect of operation.effects) {
      input.context.signal?.throwIfAborted();
      await input.environment?.verifyEffect?.({ context: input.context, operation, effect, decision });
    }
  } else {
    await adapterExecution.recordControlFlow(operation);
  }
  return entries;
}

async function selectInputModality(
  operation: TransitionPlanOperation,
  context: JourneyExecutionContext
): Promise<InputModalityDecision | undefined> {
  if (operation.activation.requiredInputModalityProfiles.length === 0) return undefined;
  if (!context.profile.selectInputModality) {
    throw new Error(`Profile ${context.profile.id} has no input modality selector for transition ${operation.transition.id}`);
  }
  return context.profile.selectInputModality(operation, context);
}

async function ensureEntryOpen(
  execution: JourneyAdapterExecution,
  entries: EntryMap,
  operation: JourneyPlanOperation
): Promise<EntryMap> {
  if (!operation.entryBinding) return entries;
  const sessionKey = JSON.stringify([operation.source?.references?.journeyItemId, operation.actorId, operation.touchpointId]);
  const entryKey = `${operation.entry.id}\u0000${operation.entryBinding.id}\u0000${operation.entryBinding.value}`;
  if (entries.get(sessionKey) === entryKey) return entries;
  await execution.openEntry(operation);
  return new Map([...entries, [sessionKey, entryKey]]);
}

async function attempt(work: () => Promise<void> | void): Promise<JourneyOutcome> {
  try {
    await work();
    return passedOutcome;
  } catch (error) {
    return failedOutcome(error);
  }
}

async function attemptBatch(work: () => Promise<ExecutionBatch>): Promise<ExecutionBatch> {
  try {
    return await work();
  } catch (error) {
    return emptyBatch(failedOutcome(error));
  }
}

function emptyBatch(outcome: JourneyOutcome): ExecutionBatch {
  return Object.freeze({ outcome, operations: Object.freeze([]) });
}

function executionResult(context: JourneyExecutionContext, outcome: JourneyOutcome): ExecutionResult {
  return Object.freeze({ executionId: context.executionId, profileId: context.profile.id, outcome });
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function operationEvidence(
  operation: JourneyPlanOperation,
  adapter: JourneyComponentDescriptor,
  outcome: JourneyOutcome
): JourneyOperationEvidence {
  const graphNodeId = operation.source?.references?.graphNodeId;
  return Object.freeze({
    operationId: operation.id,
    ...(typeof graphNodeId === "string" ? { graphNodeId } : {}),
    ...(operation.source?.references ? { source: Object.freeze({ references: Object.freeze(Object.fromEntries(
      Object.entries(operation.source.references).map(([key, value]) => [key, typeof value === "string" ? value : Object.freeze([...value])])
    )) }) } : {}),
    operationKind: operation.kind,
    adapter,
    outcome
  });
}

/** Observe cooperative cancellation without leaking abort listeners or unhandled work. */
async function abortable<T>(work: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return work();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Journey cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
