import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoveredMaterialization } from "@openuji/journey-plugin";
import { describeSteps, summarizeDiscoveries } from "../src/discover.js";

const record = (profileId: string, overrides: Partial<DiscoveredMaterialization> = {}): DiscoveredMaterialization => ({
  testId: "pages", profileId, operationId: "op", transitionId: "urn:transition:enter-title", modalityId: "urn:openuji:input-modality:keyboard-text-entry",
  status: "found", steps: [{ kind: "move", moveKindId: "operability:nextStop", locatorId: "urn:locator:title" }], ...overrides
});

test("a path is proposed once when every profile found the same one", () => {
  const summary = summarizeDiscoveries([record("default"), record("keyboard-only")]);
  assert.equal(summary.proposals.length, 1);
  assert.deepEqual(summary.conflicts, []);
});

test("paths that depend on the profile are reported and not proposed", () => {
  const differing = summarizeDiscoveries([record("default"), record("keyboard-only", { steps: [{ kind: "move", moveKindId: "operability:previousStop", locatorId: "urn:locator:title" }] })]);
  assert.equal(differing.proposals.length, 0);
  assert.equal(differing.conflicts[0].length, 2);
  // Moves that would take focus away from a field another profile already reached.
  const focused = summarizeDiscoveries([record("default", { status: "at-target", steps: undefined }), record("keyboard-only")]);
  assert.equal(focused.proposals.length, 0);
  assert.equal(focused.conflicts.length, 1);
});

test("declared, already focused and missing paths are counted apart from proposals", () => {
  const summary = summarizeDiscoveries([
    record("default", { transitionId: "urn:transition:a", modalityId: "observability:keyboard", status: "declared", steps: undefined }),
    record("default", { transitionId: "urn:transition:b", status: "at-target", steps: undefined }),
    record("keyboard-only", { transitionId: "urn:transition:c", modalityId: "observability:keyboard", status: "not-found", steps: undefined, note: "never reached" })
  ]);
  assert.deepEqual([summary.proposals.length, summary.declared, summary.atTarget, summary.notFound.length], [0, 1, 1, 1]);
});

test("a rediscovered field that already has focus is proposed, so its stale steps can be removed", () => {
  const summary = summarizeDiscoveries([record("default", { status: "at-target", steps: undefined, replaces: "urn:materialization:enter-title:text-entry" })]);
  assert.equal(summary.proposals.length, 1);
  assert.equal(summary.atTarget, 0);
});

test("steps read as repeated moves", () => {
  assert.equal(describeSteps([
    { kind: "move", moveKindId: "operability:previousStop" }, { kind: "move", moveKindId: "operability:previousStop" },
    { kind: "move", moveKindId: "operability:nextItem" }, { kind: "activation" }
  ]), "previousStop ×2, nextItem, activate");
  assert.equal(describeSteps([]), "nothing (focus is already there)");
});
