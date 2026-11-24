import assert from "node:assert/strict";
import test from "node:test";

import { androidAccessibilityObserver, androidExecutorName, isAndroidAccessibilityOutput } from "../src/index.js";

test("excluded phases journal frozen not-applicable evidence without device or artifact I/O", async () => {
  let deviceReads = 0;
  let artifactWrites = 0;
  const observer = androidAccessibilityObserver({
    reportId: "test",
    excludedPhaseIds: Object.freeze(["urn:phase:setup"]),
    screenshots: true,
    async writeArtifact() {
      artifactWrites++;
      throw new Error("artifact write must not run");
    }
  });
  await observer.observeOperation!({
    stage: "state-asserted",
    execution: { runId: "run", executionId: "execution", profile: { id: "profile" } },
    operation: Object.freeze({
      id: "setup-state",
      kind: "state",
      actorId: "actor",
      touchpointId: "touchpoint",
      source: Object.freeze({ references: Object.freeze({ phaseId: "urn:phase:setup" }) })
    }),
    expectedMatchCount: 1,
    targets: Object.freeze([]),
    session: Object.freeze({
      source() { deviceReads++; throw new Error("hierarchy read must not run"); },
      deviceMetrics() { deviceReads++; throw new Error("metrics read must not run"); },
      screenshot() { deviceReads++; throw new Error("screenshot must not run"); }
    })
  } as never);

  assert.equal(deviceReads, 0);
  assert.equal(artifactWrites, 0);
  const fact = observer.evidence[0];
  assert.equal(fact?.kind, "operation-observed");
  if (fact?.kind !== "operation-observed") throw new Error("Missing operation evidence");
  assert.deepEqual(fact.evidence.notApplicable, {
    phaseId: "urn:phase:setup",
    reason: "Phase urn:phase:setup is excluded from accessibility capture."
  });
  assert.ok(Object.isFrozen(fact.evidence));
  assert.ok(Object.isFrozen(fact.evidence.notApplicable));
});

test("native capture records a detached journal, measurements and evidence files, and nothing for presentation", async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileEvidenceStore } = await import("@openuji/journey-run-record/node");
  const store = fileEvidenceStore(await mkdtemp(join(tmpdir(), "native-output-")), "tests/native/files");
  const operation = { id: "compiled-state", sequence: 0, kind: "state" as const, actorId: "actor", touchpointId: "device", entry: { id: "entry", stateId: "state" }, state: { id: "state" }, surface: { id: "surface" }, target: { bindings: [], expectedMatchCount: 0, observation: { bindings: [], stateId: "state", surfaceId: "surface", expectedMatchCount: 0 } } };
  const plan = { id: "manual-plan", operations: [operation] };
  const observer = androidAccessibilityObserver({ reportId: "native", screenshots: true, writeArtifact: (input) => store.write(input), now: () => "2026-11-19" });
  const execution = { runId: "run", executionId: "execution", profile: { id: "touch" }, plan };
  observer.onExecutionStarted!({ execution });
  await observer.observeOperation!({ stage: "state-asserted", execution, operation, expectedMatchCount: 0, targets: [], session: { async source() { return '<hierarchy><node class="android.widget.TextView" text="Example" bounds="[0,0][100,100]"/></hierarchy>'; }, async deviceMetrics() { return { densityDpi: 160 }; }, async screenshot() { return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8R8AAAAASUVORK5CYII="; } } } as never);
  const result: import("@openuji/journey-runner").RunResult = { ok: true, runId: "run", plan: { id: plan.id }, assessments: [{ kind: "applicable", profile: { id: "touch" } }], executions: [{ executionId: "execution", profileId: "touch", outcome: { kind: "passed" } }], evidence: { executions: [{ executionId: "execution", profileId: "touch", operations: [{ operationId: operation.id, operationKind: "state", outcome: { kind: "passed" } }] }] }, errors: [] };
  const output = observer.output(result);
  assert.ok(isAndroidAccessibilityOutput(JSON.parse(JSON.stringify(output))));
  assert.deepEqual(Object.keys(output).sort(), ["errors", "evidence", "id", "kind", "measurements"]);
  assert.deepEqual({ reportId: output.evidence.reportId, createdAt: output.evidence.createdAt, strict: output.evidence.strict, facts: output.evidence.journal.length }, { reportId: "native", createdAt: "2026-11-19", strict: false, facts: 2 });
  assert.equal(output.measurements[0].id, "android/hierarchy-findings");
  assert.equal(output.measurements[0].status, "available");
  assert.deepEqual(store.files.map((file) => [file.contentType, file.scope?.profileId]), [["application/xml", "touch"], ["image/png", "touch"]]);
  assert.ok(store.files.every((file) => file.href.startsWith("tests/native/files/android-")));
});

test("the executor name in the evidence entry matches the Appium executor", async () => {
  const { appiumExecutorName } = await import("@openuji/journey-executor-appium/observation");
  assert.equal(androidExecutorName, appiumExecutorName);
});
