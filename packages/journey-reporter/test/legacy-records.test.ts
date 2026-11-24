import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, compareRuns } from "../src/index.js";
import { fixtureConfig } from "./fixtures.js";

/** Run directories in the run-record package: the same run written as format version 1 and as version 2. */
const fixture = (version: 1 | 2) => fileURLToPath(new URL(`../../journey-run-record/test/fixtures/v${version}`, import.meta.url));
const generatedAt = "2026-11-24T12:00:00.000Z";

async function copy(version: 1 | 2): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `legacy-v${version}-`));
  await cp(fixture(version), directory, { recursive: true });
  return directory;
}

/** Every file below `directory`, by relative path, as text. */
async function files(directory: string): Promise<Record<string, string>> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const result: Record<string, string> = {};
  for (const entry of entries.filter((item) => item.isFile())) {
    const path = join(entry.parentPath, entry.name);
    result[relative(directory, path)] = await readFile(path, "utf8");
  }
  return result;
}

test("a report built from a version-1 run equals the report built from the same run written as version 2", async () => {
  const [legacy, current] = [await copy(1), await copy(2)];
  const options = { config: fixtureConfig(), generatedAt };
  const legacyModel = (await buildReport(legacy, options)).model;
  assert.deepEqual(legacyModel, (await buildReport(current, options)).model);
  assert.deepEqual(await files(join(legacy, "report")), await files(join(current, "report")));
  const testModel = JSON.parse((await files(join(legacy, "report")))["tests/mixed.json"]!);
  assert.deepEqual(testModel.journeys.map((item: { executor: string }) => item.executor), ["web", "android"]);
});

test("comparing a version-1 baseline with a version-2 run equals comparing two version-1 runs", async () => {
  const options = { config: fixtureConfig(), generatedAt, title: "Legacy" };
  const mixedOutput = await mkdtemp(join(tmpdir(), "legacy-compare-mixed-"));
  const legacyOutput = await mkdtemp(join(tmpdir(), "legacy-compare-v1-"));
  const mixed = await compareRuns({ baseline: await copy(1), candidate: await copy(2), outputDir: mixedOutput, ...options });
  const legacy = await compareRuns({ baseline: await copy(1), candidate: await copy(1), outputDir: legacyOutput, ...options });
  assert.deepEqual(mixed, legacy);
  // Subjects are republished by the current writer, so both sides are version 2 on disk. Subject reports
  // are built at comparison time and stamped with it, so only `generatedAt` may differ.
  const stable = async (directory: string) => Object.fromEntries(Object.entries(await files(directory))
    .map(([path, text]) => [path, text.replace(/"generatedAt":"[^"]*"/g, '"generatedAt":"*"')]));
  assert.deepEqual(await stable(mixedOutput), await stable(legacyOutput));
  assert.equal(JSON.parse((await files(mixedOutput))["subjects/baseline/run.json"]!).version, 2);
});
