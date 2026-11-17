import type { TestResultBundle } from "@openuji/journey-plugin";

export function savedTest(): TestResultBundle {
  const base = { actorId: "actor", touchpointId: "app", entry: { id: "entry", stateId: "same-source-state" }, segment: "task" };
  const operation = (id: string, label: string, sequence: number) => ({ ...base, id, sequence, kind: "state" as const, state: { id: "same-source-state", label }, surface: { id: "surface" }, target: { bindings: [], expectedMatchCount: 0, observation: { stateId: "same-source-state", surfaceId: "surface", bindings: [], expectedMatchCount: 0 } } });
  return { kind: "test", id: "manual-plan", segments: [], views: {}, plan: { id: "manual", operations: [operation("first-occurrence", "Arrival", 0), operation("second-occurrence", "Completion", 1)] },
    result: { ok: false, runId: "run", plan: { id: "manual" }, errors: [], assessments: [{ kind: "applicable", profile: { id: "keyboard" } }], executions: [{ executionId: "execution", profileId: "keyboard", outcome: { kind: "failed", error: { name: "Error", message: "Failure" } } }], evidence: { executions: [{ executionId: "execution", profileId: "keyboard", operations: [{ operationId: "first-occurrence", operationKind: "state", outcome: { kind: "passed" } }, { operationId: "second-occurrence", operationKind: "state", outcome: { kind: "failed", error: { name: "Error", message: "Completion failed" } } }] }] } },
    outputs: [], reportingErrors: [], artifacts: [
      { name: "right.png", href: "right.png", contentType: "image/png", scope: { runId: "run", executionId: "execution", profileId: "keyboard", operationId: "first-occurrence" } },
      { name: "wrong.png", href: "wrong.png", contentType: "image/png", scope: { runId: "old-run", executionId: "execution", profileId: "keyboard", operationId: "second-occurrence" } }
    ] };
}

