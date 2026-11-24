import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { executionDescriptor, runJourney, type JourneyPlan } from "@openuji/journey-runner";
import { playwrightExecutorName } from "@openuji/journey-executor-playwright";
import { fileEvidenceStore } from "@openuji/journey-run-record/node";
import { axeExecutorName, axeObserver, isAxeOutput } from "../src/index.js";
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
    reportId: "test", artifacts: {} as never,
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

test("axe captures standalone evidence without Playwright TestInfo, example fixtures, or any report output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-axe-"));
  const artifacts = fileEvidenceStore(directory, "tests/standalone/files");
  const operation = {
    id: "state", sequence: 0, kind: "state",
    actorId: "actor", touchpointId: "touchpoint",
    entry: { id: "entry", stateId: "state" }, state: { id: "state" }, surface: { id: "surface" },
    target: { expectedMatchCount: 0, bindings: [], observation: { stateId: "state", surfaceId: "surface", expectedMatchCount: 0, bindings: [] } }
  } as const;
  const plan = { id: "standalone-plan", operations: [operation] } as unknown as JourneyPlan;
  const profile = { id: "standalone" };
  const execution = executionDescriptor({ plan, profile, runId: "standalone", executionId: "standalone" });
  const observer = axeObserver({ artifacts, reportId: "standalone", sourceScreenshots: { states: true }, now: () => "2026-11-19" });
  await observer.onExecutionStarted!({ execution });
  await observer.observeOperation!({
    stage: "state-asserted", execution, operation, expectedMatchCount: 0, locator: {} as never,
    page: { async screenshot() { return Buffer.from("png"); } } as never
  } as never);
  const result = await runJourney({
    plan: { id: plan.id, operations: [] }, profiles: [profile], runId: "standalone",
    executor: { name: "fixture", createSession() { return { start() {}, close() {}, openEntry() {}, assertState() {}, performTransition() {}, recordControlFlow() {} }; } }
  });
  const output = observer.output(result);
  assert.ok(isAxeOutput(output));
  assert.deepEqual(Object.keys(output).sort(), ["errors", "evidence", "id", "kind", "measurements"]);
  assert.deepEqual(Object.keys(output.evidence).sort(), ["createdAt", "journal", "reportId", "wcagTags"]);
  assert.equal(output.evidence.journal.length, 2);
  assert.deepEqual(artifacts.files.map((file) => [file.href, file.contentType]), [["tests/standalone/files/standalone-000-state.source.playwright-screenshot.png", "image/png"]]);
  for (const file of artifacts.files) await access(join(directory, file.href));
});

test("the executor name in the evidence entry matches the Playwright executor", () => {
  assert.equal(axeExecutorName, playwrightExecutorName);
});
