import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { executionDescriptor, runJourney, type JourneyPlan } from "@openuji/journey-runner";
import { fileArtifactStore } from "@openuji/journey-runtime";
import { axeObserver } from "../src/index.js";
import { collectAxeEvidence } from "../src/observer/collect-evidence.js";

test("excluded phases append frozen not-applicable evidence before capture or audit", async () => {
  let pageReads = 0;
  let auditRuns = 0;
  const operation = Object.freeze({
    id: "setup-state",
    kind: "state",
    actorId: "actor",
    touchpointId: "touchpoint",
    source: Object.freeze({ references: Object.freeze({ phaseId: "urn:phase:setup" }) })
  });
  const evidence = await collectAxeEvidence({
    stage: "state-asserted",
    execution: { runId: "run", executionId: "execution", profile: { id: "profile" } },
    operation,
    expectedMatchCount: 1,
    locator: Object.freeze({}),
    page: Object.freeze({ screenshot() { pageReads++; throw new Error("capture must not run"); } })
  } as never, {
    reportId: "test",
    excludedPhaseIds: Object.freeze(["urn:phase:setup"]),
    sourceScreenshots: { states: true }
  }, async () => {
    auditRuns++;
    throw new Error("audit must not run");
  });

  assert.equal(pageReads, 0);
  assert.equal(auditRuns, 0);
  assert.ok("notApplicable" in evidence);
  if (!("notApplicable" in evidence)) throw new Error("Missing not-applicable evidence");
  assert.deepEqual(evidence.notApplicable, {
    phaseId: "urn:phase:setup",
    reason: "Phase urn:phase:setup is excluded from accessibility capture."
  });
  assert.ok(Object.isFrozen(evidence));
  assert.ok(Object.isFrozen(evidence.notApplicable));
});

test("axe writes standalone artifacts without Playwright TestInfo or example fixtures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-axe-"));
  const artifacts = fileArtifactStore(directory);
  const operation = {
    id: "state", sequence: 0, kind: "state",
    actorId: "actor", touchpointId: "touchpoint",
    entry: { id: "entry", stateId: "state" }, state: { id: "state" }, surface: { id: "surface" },
    target: { expectedMatchCount: 0, bindings: [], observation: { stateId: "state", surfaceId: "surface", expectedMatchCount: 0, bindings: [] } }
  } as const;
  const plan = { id: "standalone-plan", operations: [operation] } as unknown as JourneyPlan;
  const profile = { id: "standalone" };
  const execution = executionDescriptor({ plan, profile, runId: "standalone", executionId: "standalone" });
  const observer = axeObserver({ artifacts, reportId: "standalone", sourceScreenshots: { states: true } });
  await observer.onExecutionStarted!({ execution });
  await observer.observeOperation!({
    stage: "state-asserted", execution, operation, expectedMatchCount: 0, locator: {} as never,
    page: { async screenshot(input: { path: string }) { await writeFile(input.path, Buffer.from("png")); } } as never
  } as never);
  const result = await runJourney({
    plan: { id: plan.id, operations: [] }, profiles: [profile], runId: "standalone",
    adapter: { name: "fixture", createExecution() { return { start() {}, close() {}, openEntry() {}, assertState() {}, performTransition() {}, recordControlFlow() {} }; } }
  });
  await observer.report({ result, json: JSON.stringify(result) });

  assert.ok(artifacts.files.some((file) => file.name.includes("standalone") && file.path.endsWith(".html")));
  assert.ok(artifacts.files.some((file) => file.path.endsWith(".png")));
  for (const file of artifacts.files) await access(file.path);
});
