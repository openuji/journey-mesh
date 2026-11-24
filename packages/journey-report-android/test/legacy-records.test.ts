import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { routedElsewhere } from "@openuji/journey-plugin";
import { readRunRecord } from "@openuji/journey-run-record/node";
import { androidExecutorName } from "@openuji/journey-observer-android-accessibility/evidence";

const legacyRun = fileURLToPath(new URL("../../journey-run-record/test/fixtures/v1", import.meta.url));

test("operations of a version-1 run are attributed to the Appium executor as before the rename", async () => {
  const [record] = (await readRunRecord(legacyRun)).tests;
  const [execution] = record!.result.evidence.executions;
  const items = execution!.operations.map((attempted) => ({
    executionId: execution!.executionId, profileId: execution!.profileId,
    operation: record!.plan.operations.find((operation) => operation.id === attempted.operationId)!, attempted
  }));
  // web-arrival ran on Playwright, native-arrival on Appium; the other two name neither executor.
  assert.deepEqual(items.map((item) => routedElsewhere(item, androidExecutorName)), [true, false, true, true]);
});
