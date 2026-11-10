import assert from "node:assert/strict";
import test from "node:test";

import { androidAccessibilityObserver } from "../src/index.js";

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
