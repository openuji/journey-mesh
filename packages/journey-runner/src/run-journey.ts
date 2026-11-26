import type {
  InputModalityDecision,
  JourneyPlan,
  JourneyPlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-execution-model";

import type {
  JourneyExecutor,
  JourneyExecutorSession,
  JourneyExecutionContext,
  JourneyProfile
} from "./executors/contracts.js";
import type { JourneyEnvironment } from "./environment/contracts.js";
import { errorToJourneyRunError } from "./errors.js";
import { MaterializationFailedError, fallbackApplies } from "./executors/materialization.js";
import { componentDescriptor, executionDescriptor, profileDescriptor } from "./observers/contracts.js";
import type { JourneyComponentDescriptor, JourneyObserver } from "./observers/contracts.js";
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
  executor: JourneyExecutor;
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

/** `recovered` fails the execution without stopping it: transitions performed through their fallback. */
type OperationFold = ExecutionBatch & Readonly<{ entries: EntryMap; recovered: JourneyOutcome }>;

/** `missed` is the failure that a transition's fallback materialization got past. */
type OperationRun = Readonly<{ entries: EntryMap; missed?: Error }>;

type ProfileExecutionInput = Readonly<{
  executor: JourneyExecutor;
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

  const runStartErrors = await observerDispatcher.runStarted({
    executor: componentDescriptor(options.executor),
    plan: options.plan,
    profiles: Object.freeze(options.profiles.map(profileDescriptor)),
    assessments,
    runId
  });
  const outcomes = await candidates.reduce<Promise<readonly ProfileExecutionOutcome[]>>(async (pending, candidate) => {
    const previous = await pending;
    if (candidate.assessment.kind !== "applicable") return previous;
    const outcome = await runProfileExecution({
      executor: options.executor,
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
    runErrors: runStartErrors
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
  const startErrors = context.signal?.aborted ? [] : await observerDispatcher.executionStarted(descriptor);
  const batch = await runProfileBody(input);
  // An observer that failed fails the execution; the profile ran as it would have without it.
  const outcome = startErrors.reduce(
    (previous, error) => combineOutcomes(previous, failedOutcome(error), "execution observer"),
    batch.outcome
  );
  const beforeObserver = executionResult(context, outcome);
  const completionError = await observerDispatcher.executionCompleted(descriptor, beforeObserver);
  const execution = completionError
    ? executionResult(context, combineOutcomes(outcome, failedOutcome(completionError), "execution observer"))
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

async function runProfileBody(input: ProfileExecutionInput): Promise<ExecutionBatch> {
  try {
    input.context.signal?.throwIfAborted();
    // Routing is resolved before shared fixture setup can change service state.
    const executors = new Map(input.context.plan.operations.map((operation) => [
      operation,
      Object.freeze(componentDescriptor(input.executor.describeOperation?.(operation) ?? input.executor))
    ]));
    return await withEnvironment(input.context, input.environment, () => withExecutor(input, executors));
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

async function withExecutor(
  input: ProfileExecutionInput,
  executors: ReadonlyMap<JourneyPlanOperation, JourneyComponentDescriptor>
): Promise<ExecutionBatch> {
  try {
    const execution = input.executor.createSession({ context: input.context });
    // Closing on cancellation also interrupts pending browser/device commands.
    let closing: Promise<void> | undefined;
    const close = (executionFailed: boolean) => closing ??= Promise.resolve().then(() => execution.close({ executionFailed }));
    const onAbort = () => { void close(true).catch(() => {}); };
    input.context.signal?.addEventListener("abort", onAbort, { once: true });
    const startup = await attempt(() => abortable(() => execution.start(), input.context.signal));
    const batch = startup.kind === "failed" ? emptyBatch(startup) :
      await attemptBatch(() => runOperations(input, execution, executors));
    input.context.signal?.removeEventListener("abort", onAbort);
    const cleanup = await attempt(() => close(batch.outcome.kind === "failed"));
    return Object.freeze({ ...batch, outcome: combineOutcomes(batch.outcome, cleanup, "cleanup") });
  } catch (error) {
    // createSession failed before returning a handle that could be closed.
    return emptyBatch(failedOutcome(error));
  }
}

async function runOperations(
  input: ProfileExecutionInput,
  session: JourneyExecutorSession,
  executors: ReadonlyMap<JourneyPlanOperation, JourneyComponentDescriptor>
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
      const { entries, missed } = await abortable(() => executeOperation(input, session, previous.entries, operation), context.signal);
      const durationMs = performance.now() - startedAt;
      const outcome = missed ? failedOutcome(missed) : passedOutcome;
      await progress.publish(missed
        ? { type: "operation-failed", ...operationProgress, durationMs, error: errorToJourneyRunError(missed) }
        : { type: "operation-completed", ...operationProgress, durationMs });
      return Object.freeze({
        entries,
        outcome: passedOutcome,
        recovered: combineOutcomes(previous.recovered, outcome, "a later transition"),
        operations: Object.freeze([...previous.operations, operationEvidence(operation, executors.get(operation)!, outcome)])
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
        recovered: previous.recovered,
        operations: Object.freeze([...previous.operations, operationEvidence(operation, executors.get(operation)!, outcome)])
      });
    }
  }, Promise.resolve(Object.freeze({ ...emptyBatch(passedOutcome), entries: new Map<string, string>(), recovered: passedOutcome })));
  return Object.freeze({ outcome: combineOutcomes(completed.recovered, completed.outcome, "a later operation"), operations: completed.operations });
}

async function executeOperation(
  input: ProfileExecutionInput,
  session: JourneyExecutorSession,
  currentEntries: EntryMap,
  operation: JourneyPlanOperation
): Promise<OperationRun> {
  input.context.signal?.throwIfAborted();
  const entries = await ensureEntryOpen(session, currentEntries, operation);
  input.context.signal?.throwIfAborted();
  if (operation.kind === "state") {
    await session.assertState(operation);
  } else if (operation.kind === "transition") {
    const decision = await selectInputModality(operation, input.context);
    const { performed, missed } = await performTransition(session, operation, decision, input.context.signal);
    input.context.signal?.throwIfAborted();
    for (const effect of operation.effects) {
      input.context.signal?.throwIfAborted();
      await input.environment?.verifyEffect?.({ context: input.context, operation, effect, decision: performed });
    }
    if (missed) return { entries, missed };
  } else {
    await session.recordControlFlow(operation);
  }
  return { entries };
}

/**
 * Performs the transition as decided, and through the decision's fallback when a check of its
 * materialization failed and `fallbackApplies`. Returns the decision that took the transition and, after
 * a fallback, the failure it got past. A failing fallback fails the operation with both errors.
 */
async function performTransition(
  session: JourneyExecutorSession,
  operation: TransitionPlanOperation,
  decision: InputModalityDecision | undefined,
  signal: AbortSignal | undefined
): Promise<Readonly<{ performed: InputModalityDecision | undefined; missed?: Error }>> {
  try {
    await session.performTransition(operation, decision);
    return { performed: decision };
  } catch (error) {
    if (!decision?.fallback || signal?.aborted || !MaterializationFailedError.is(error)) throw error;
    const { fallback, ...chosen } = decision;
    if (!fallbackApplies(fallback, error.sentInput)) {
      throw new MaterializationFailedError(`${error.message} (${fallback.id} was not performed: input had been sent, and it names no start)`, error.sentInput, { cause: error });
    }
    const performed = Object.freeze({ ...chosen, materialization: fallback });
    try {
      await session.performTransition(operation, performed);
    } catch (second) {
      throw new AggregateError([error, second], `${error.message}; ${fallback.id} failed too: ${errorToJourneyRunError(second).message}`);
    }
    const missed = new Error(`${error.message} (the transition was then taken through ${fallback.id})`, { cause: error });
    return { performed, missed };
  }
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
  execution: JourneyExecutorSession,
  entries: EntryMap,
  operation: JourneyPlanOperation
): Promise<EntryMap> {
  if (!operation.entryBinding) return entries;
  const sessionKey = JSON.stringify([operation.segment, operation.actorId, operation.touchpointId]);
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
  executor: JourneyComponentDescriptor,
  outcome: JourneyOutcome
): JourneyOperationEvidence {
  return Object.freeze({
    operationId: operation.id,
    ...(operation.source?.references ? { source: Object.freeze({ references: Object.freeze(Object.fromEntries(
      Object.entries(operation.source.references).map(([key, value]) => [key, typeof value === "string" ? value : Object.freeze([...value])])
    )) }) } : {}),
    operationKind: operation.kind,
    executor,
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
