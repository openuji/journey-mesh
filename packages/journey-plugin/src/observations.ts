import type { JourneyExecutionDescriptor, JourneyOperationEvidence, JourneyPlanOperation, RunResult } from "@openuji/journey-runner";

/** The append-only journal shape observers keep: execution starts and per-operation observations. */
export type ObservationFact<E> =
  | Readonly<{ kind: "execution-started"; execution: JourneyExecutionDescriptor }>
  | Readonly<{ kind: "operation-observed"; evidence: E }>;
type Observation = Readonly<{ runId: string; executionId: string; profileId: string; operation: JourneyPlanOperation }>;

/** One planned operation of one execution, with what the observer and the runner recorded for it. */
export type ObservedOperation<E> = Readonly<{
  executionId: string;
  profileId: string;
  operation: JourneyPlanOperation;
  /** The last observation of this operation, if any. */
  observed?: E;
  /** The runner's record: outcome and the adapter that executed it. */
  attempted?: JourneyOperationEvidence;
}>;

/**
 * Every planned operation of every execution started in `result`, once, joined with its last
 * observation and the runner's record. Unobserved operations stay in the list, so reports can say
 * why they were not assessed instead of silently omitting them.
 */
export function observedOperations<E extends Observation>(journal: readonly ObservationFact<E>[], result: RunResult): readonly ObservedOperation<E>[] {
  const facts = journal.filter((fact) => (fact.kind === "execution-started" ? fact.execution.runId : fact.evidence.runId) === result.runId);
  const items = new Map<string, { executionId: string; profileId: string; operation: JourneyPlanOperation; observed?: E }>();
  const key = (executionId: string, operationId: string) => JSON.stringify([executionId, operationId]);
  for (const fact of facts) {
    if (fact.kind === "execution-started") {
      for (const operation of fact.execution.plan.operations) {
        const id = key(fact.execution.executionId, operation.id);
        if (!items.has(id)) items.set(id, { executionId: fact.execution.executionId, profileId: fact.execution.profile.id, operation });
      }
      continue;
    }
    const { executionId, profileId, operation } = fact.evidence;
    const id = key(executionId, operation.id);
    items.set(id, { ...(items.get(id) ?? { executionId, profileId }), operation, observed: fact.evidence });
  }
  return [...items.values()].map((item) => {
    const attempted = result.evidence.executions.find((execution) => execution.executionId === item.executionId)?.operations.find((operation) => operation.operationId === item.operation.id);
    return Object.freeze({ ...item, ...(attempted ? { attempted } : {}) });
  });
}

/** True when the runner routed an unobserved operation to an adapter other than the observer's own. */
export function routedElsewhere(item: ObservedOperation<unknown>, adapterName: string): boolean {
  return !item.observed && !!item.attempted?.adapter && item.attempted.adapter.name !== adapterName;
}
