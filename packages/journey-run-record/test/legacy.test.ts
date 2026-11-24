import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openRunRecord, runRecordVersion } from "../src/index.js";
import { readRunRecord, runReader, writeRunRecord } from "../src/node.js";

const fixture = (version: 1 | 2) => fileURLToPath(new URL(`./fixtures/v${version}`, import.meta.url));
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));

test("a version-1 run record reads as its version-2 equivalent: executor fields and current component names", async () => {
  const legacy = await openRunRecord(runReader(fixture(1)));
  const current = await openRunRecord(runReader(fixture(2)));
  assert.deepEqual(legacy.run, current.run);
  assert.equal(legacy.run.version, runRecordVersion);
  const normalized = await legacy.loadTest("mixed");
  assert.deepEqual(normalized, await current.loadTest("mixed"));
  // Field order is kept, so normalized records serialize exactly like records written as version 2.
  assert.equal(JSON.stringify(normalized), JSON.stringify(await json(join(fixture(2), "tests/mixed/run.json"))));
  const names = normalized.result.evidence.executions[0].operations.map((operation) => operation.executor?.name);
  assert.deepEqual(names, [
    "@openuji/journey-executor-playwright", "@openuji/journey-executor-appium", "@openuji/journey-runner/routed-executor",
    // Names the reader does not know are not rewritten.
    "@example/journey-custom-adapter"
  ]);
  assert.deepEqual(normalized.segments.map((segment) => segment.executor), ["web", "android"]);
});

test("a version-1 run rewritten by the current writer is version 2 and reads unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "run-record-legacy-"));
  await writeRunRecord(directory, await readRunRecord(fixture(1)));
  assert.equal((await json(join(directory, "run.json"))).version, 2);
  assert.equal((await json(join(directory, "tests/mixed/run.json"))).version, 2);
  assert.deepEqual(await readRunRecord(directory), await readRunRecord(fixture(2)));
});

test("unknown versions are rejected, and a test record must have the version of its run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "run-record-legacy-"));
  await cp(fixture(1), directory, { recursive: true });
  const index = await json(join(directory, "run.json"));
  await writeFile(join(directory, "run.json"), JSON.stringify({ ...index, version: 3 }));
  await assert.rejects(openRunRecord(runReader(directory)), /version 1 or 2/);
  await writeFile(join(directory, "run.json"), JSON.stringify({ ...index, version: 2 }));
  await assert.rejects((await openRunRecord(runReader(directory))).loadTest("mixed"), /Invalid test record for mixed/);
});
