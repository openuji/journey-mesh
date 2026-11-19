import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRunRecord, testFailures, testPassed, testRecordFormat, testRecordHref, validateHref, type SuiteRun, type TestRecord } from "../src/index.js";
import { fileEvidenceStore, readRunRecord, runReader, writeRunRecord } from "../src/node.js";

const temporary = () => mkdtemp(join(tmpdir(), "run-record-"));
function record(id: string, overrides: Partial<TestRecord> = {}): TestRecord {
  return { format: testRecordFormat, version: 1, id, ok: true, segments: [], views: {}, plan: { id: "plan", operations: [] }, observers: [], observerErrors: [], files: [],
    result: { ok: true, runId: "run", plan: { id: "plan" }, errors: [], assessments: [], executions: [], evidence: { executions: [] } }, ...overrides };
}
const run = (tests: readonly TestRecord[]): SuiteRun => ({ ok: true, startedAt: "2026-11-19T10:00:00.000Z", finishedAt: "2026-11-19T10:01:00.000Z", errors: [], provenance: { stack: { version: "1" } }, files: [], tests });

test("a run record round-trips as plain JSON with run-relative evidence", async () => {
  const directory = await temporary();
  const store = fileEvidenceStore(directory, "tests/a%2Eb/files");
  const file = await store.write({ name: "proof.json", data: "{}", contentType: "application/json", format: "fixture/proof", scope: { runId: "run", executionId: "e", profileId: "p" } });
  assert.deepEqual(file, { name: "proof.json", href: "tests/a%2Eb/files/proof.json", contentType: "application/json", format: "fixture/proof", scope: { runId: "run", executionId: "e", profileId: "p" } });
  await writeRunRecord(directory, run([record("a.b", { files: store.files })]));
  const index = JSON.parse(await readFile(join(directory, "run.json"), "utf8"));
  assert.equal(index.format, "journey-mesh/run");
  assert.deepEqual(index.tests, [{ id: "a.b", ok: true, href: "tests/a%2Eb/run.json" }]);
  assert.equal(testRecordHref("a.b"), "tests/a%2Eb/run.json");
  const saved = await readRunRecord(join(directory, "run.json"));
  assert.deepEqual(saved.tests[0].files, store.files);
  assert.deepEqual(saved.provenance, { stack: { version: "1" } });
  assert.equal(await readFile(join(directory, file.href), "utf8"), "{}");
});

test("publishing replaces the directory atomically and drops unregistered output", async () => {
  const directory = await temporary();
  await mkdir(join(directory, "report"), { recursive: true });
  await writeFile(join(directory, "report/report.json"), "{}");
  await writeFile(join(directory, "stray.txt"), "not registered");
  await writeRunRecord(directory, run([record("a")]));
  for (const stale of ["report/report.json", "stray.txt"]) await assert.rejects(access(join(directory, stale)));
  const workspace = await temporary();
  await writeFile(join(workspace, "package.json"), "{}");
  await assert.rejects(writeRunRecord(workspace, run([])), /source workspace/);
});

test("evidence stays inside the run directory, including through symlinks", async () => {
  const directory = await temporary();
  await assert.rejects(fileEvidenceStore(directory, "tests/a/files").write({ name: "../../../escape.json", data: "", contentType: "text/plain" }), /inside its store/);
  for (const href of ["../x", "a/../b", "/abs", "a//b", "c:\\x", "a?b"]) assert.throws(() => validateHref(href), /Invalid run record reference/);
  const outside = await temporary();
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(join(outside, "secret.txt"), join(directory, "link.txt"));
  await assert.rejects(runReader(directory)("link.txt"), /escapes/);
});

test("the verdict depends on execution and observer findings only", () => {
  const failingRun = record("a", { result: { ...record("a").result, ok: false, errors: [{ name: "Error", message: "state failed" }] } });
  assert.equal(testPassed(record("a")), true);
  assert.equal(testPassed(failingRun), false);
  assert.equal(testPassed(record("a", { observerErrors: [{ name: "Error", message: "invalid output" }] })), false);
  const strict = record("a", { observers: [{ id: "axe", kind: "axe", measurements: [], evidence: {}, errors: [{ name: "AxeStrictError", message: "violations" }] }] });
  assert.equal(testPassed(strict), false);
  assert.deepEqual(testFailures(strict).map((error) => error.name), ["AxeStrictError"]);
});

test("readers reject other formats instead of guessing", async () => {
  const directory = await temporary();
  await writeFile(join(directory, "run.json"), JSON.stringify({ format: "journey-mesh/report", version: 1 }));
  await assert.rejects(openRunRecord(runReader(directory)), /Expected a Journey Mesh run record/);
});
