import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadSuiteConfig, validateSuite } from "@openuji/journey-host";
const example = new URL("../", import.meta.url);
const meshes = ["comparison/nc34.mesh.yaml", "comparison/pr66147.mesh.yaml"].map((path) => new URL(path, example).pathname);

test("each comparison subject is an ordinary suite that owns its stack identity, label and output", async () => {
  const [left, right] = await Promise.all(meshes.map(async (path) => (await loadSuiteConfig(path, {})).config));
  const stack = (config: typeof left) => config.services.stack.options;
  assert.notEqual(stack(left).project, stack(right).project);
  assert.notEqual(stack(left).directory, stack(right).directory);
  assert.notDeepEqual(stack(left).environment, stack(right).environment);
  assert.match(String(stack(left).image), /@sha256:/);
  const build = stack(right).build as { repository: string; pullRequest?: unknown; sha?: unknown };
  assert.equal(build.pullRequest, 66147, "the candidate is the pull request itself");
  assert.equal(build.sha, undefined, "the pull request is not pinned to a commit");
  assert.equal(stack(right).expectedVersion, undefined, "the version is read from the pull request's own source");
  assert.ok(left.label && right.label && left.label !== right.label);
  assert.notEqual(left.outputDir, right.outputDir);
  // Pairing by equal test and profile IDs needs no explicit correspondence.
  const executions = (config: typeof left) => config.tests.flatMap((test) => test.profiles.map((profile) => `${test.id}/${profile.id}`));
  assert.deepEqual(executions(left), executions(right));
  for (const path of meshes) await validateSuite(path, { env: {} });
  const scripts = JSON.parse(await readFile(new URL("package.json", example), "utf8")).scripts as Record<string, string>;
  assert.match(scripts["comparison:compare"], /journey-mesh compare test-results\/nc34\/bundle\.json test-results\/pr66147\/bundle\.json/);
});
