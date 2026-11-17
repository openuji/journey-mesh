import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { stringify } from "yaml";
import { compareBundles, publishReport } from "@openuji/journey-reporter";
import type { SuiteResultBundle } from "@openuji/journey-plugin";
import { runSuite } from "../src/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cli = resolve(root, "packages/journey-cli/bin/journey-mesh.mjs");
const exec = promisify(execFile);
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url));

/** Two ordinary suites; comparison only ever sees their saved bundles. */
async function setup(baselineIds = ["task", "default"], candidateIds = ["task", "default"]) {
  const directory = await mkdtemp(join(tmpdir(), "journey-comparison-"));
  const mesh = (side: string, [testId, profile]: string[]) => ({
    kind: "suite", label: `${side} system`, outputDir: `${side}-results`, model: { use: fixture("model") },
    adapters: { adapter: { use: fixture("adapter"), options: { name: side, log: "events.jsonl" }, observers: [{ use: fixture("observer") }] } },
    profiles: { default: { use: fixture("profile") } },
    tests: { [testId]: { reporters: [{ use: fixture("reporter") }], journeys: [{ id: "task", source: "model.json", select: testId, adapter: "adapter" }], profiles: [{ id: profile, journeys: { task: "default" } }] } }
  });
  const meshes = { baseline: mesh("baseline", baselineIds), candidate: mesh("candidate", candidateIds) };
  await writeFile(join(directory, "model.json"), JSON.stringify({ journeys: [...new Set([baselineIds[0], candidateIds[0]])] }));
  const save = async () => { for (const side of ["baseline", "candidate"] as const) await writeFile(join(directory, `${side}.yaml`), stringify(meshes[side])); };
  await save();
  const bundle = (side: "baseline" | "candidate") => join(directory, `${side}-results/bundle.json`);
  const run = async () => { for (const side of ["baseline", "candidate"] as const) await runSuite(join(directory, `${side}.yaml`)); };
  return { directory, meshes, save, run, bundle, output: join(directory, "comparison") };
}

test("saved suite runs pair by test and profile ID and publish isolated evidence", async () => {
  const suite = await setup(); await suite.run();
  const result = await compareBundles({ baseline: suite.bundle("baseline"), candidate: suite.bundle("candidate"), outputDir: suite.output, title: "Release check" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.pairings.map((pairing) => [pairing.baseline.test, pairing.candidate.profile]), [["task", "default"]]);
  assert.equal(result.subjects.baseline.label, "baseline system");
  assert.equal(result.subjects.candidate.source, "../candidate-results/bundle.json");
  for (const side of ["baseline", "candidate"] as const) assert.match(await readFile(join(suite.output, `subjects/${side}/task/fixture-evidence.txt`), "utf8"), /fixture/);
  // Self-contained: the page embeds its bundle and loads nothing else, so it also opens from disk.
  const page = await readFile(join(suite.output, "index.html"), "utf8");
  assert.match(page, /window\.__JOURNEY_MESH_BUNDLE__=.*Release check/s);
  assert.doesNotMatch(page, /(?:src|href)="\.?\/?assets\//);
  assert.match(await readFile(join(suite.output, "bundle.json"), "utf8"), /Release check/);
  const published = join(suite.directory, "project-path");
  await mkdir(published); await writeFile(join(published, "stale-private.env"), "not registered");
  await publishReport(join(suite.output, "bundle.json"), published);
  await assert.rejects(access(join(published, "stale-private.env")));
  await access(join(published, "subjects/baseline/task/fixture-evidence.txt"));
  await access(join(published, "index.html"));
});

test("different test and profile IDs need explicit pairings", async () => {
  const suite = await setup(["first-journey", "pointer"], ["different-journey", "keyboard"]); await suite.run();
  const inferred = await compareBundles({ baseline: suite.bundle("baseline"), candidate: suite.bundle("candidate"), outputDir: suite.output });
  assert.ok(inferred.pairings.every((pairing) => !pairing.baseline.test || !pairing.candidate.test));
  const pairings = [{ id: "same-purpose", baseline: { test: "first-journey", profile: "pointer" }, candidate: { test: "different-journey", profile: "keyboard" } }];
  const explicit = await compareBundles({ baseline: suite.bundle("baseline"), candidate: suite.bundle("candidate"), outputDir: suite.output, pairings });
  assert.deepEqual(explicit.pairings, pairings);
  await assert.rejects(compareBundles({ baseline: suite.bundle("baseline"), candidate: suite.bundle("candidate"), outputDir: suite.output, pairings: [{ ...pairings[0], candidate: { test: "missing", profile: "keyboard" } }] }), /Unknown candidate selection/);
});

test("a failed subject keeps its evidence and a missing subject is reported without hiding the other", async () => {
  const suite = await setup(); Object.assign(suite.meshes.baseline.adapters.adapter.options, { fail: "task" }); await suite.save(); await suite.run();
  const result = await compareBundles({ baseline: suite.bundle("baseline"), candidate: suite.bundle("candidate"), outputDir: suite.output });
  assert.equal(result.ok, false);
  assert.equal(result.subjects.baseline.bundle!.ok, false);
  assert.equal(result.subjects.candidate.bundle!.ok, true);
  assert.match(await readFile(join(suite.output, "bundle.json"), "utf8"), /Fixture state failure/);
  const missing = await compareBundles({ baseline: suite.bundle("baseline"), candidate: join(suite.directory, "never-ran/bundle.json"), outputDir: suite.output });
  assert.equal(missing.subjects.candidate.bundle, null);
  assert.match(missing.subjects.candidate.errors[0].message, /ENOENT/);
  await access(join(suite.output, "index.html"));
});

test("saved publication refuses evidence paths outside its bundle and keeps the previous publication", async () => {
  const suite = await setup(); await suite.run();
  const saved = JSON.parse(await readFile(suite.bundle("baseline"), "utf8")) as SuiteResultBundle;
  (saved.tests[0].artifacts as unknown as object[]).push({ name: "escape", path: "/private", href: "../secret", contentType: "text/plain" });
  await writeFile(suite.bundle("baseline"), JSON.stringify(saved));
  await mkdir(suite.output); await writeFile(join(suite.output, "retained.html"), "previous valid publication");
  await assert.rejects(compareBundles({ baseline: suite.bundle("baseline"), candidate: suite.bundle("candidate"), outputDir: suite.output }), /relative evidence/);
  await assert.rejects(publishReport(suite.bundle("baseline"), join(suite.directory, "copy")), /relative evidence/);
  assert.equal(await readFile(join(suite.output, "retained.html"), "utf8"), "previous valid publication");
  await assert.rejects(compareBundles({ baseline: suite.bundle("candidate"), candidate: suite.bundle("candidate"), outputDir: join(suite.directory, "candidate-results") }), /contains its saved bundle/);
});

test("CLI preflights every subject before running, and compare exits nonzero for failed subjects", async () => {
  const suite = await setup();
  const paths = ["baseline", "candidate"].map((side) => join(suite.directory, `${side}.yaml`));
  assert.match((await exec(process.execPath, [cli, "validate", ...paths])).stdout, /Valid tests: .*baseline\.yaml#task, .*candidate\.yaml#task/);
  suite.meshes.candidate.tests.task.journeys[0].select = "missing"; await suite.save();
  await assert.rejects(exec(process.execPath, [cli, "validate", ...paths]), (error: unknown) => (error as { code: number }).code === 2);
  await assert.rejects(access(join(suite.directory, "events.jsonl")));
  suite.meshes.candidate.tests.task.journeys[0].select = "task"; await suite.save(); await suite.run();
  const compared = await exec(process.execPath, [cli, "compare", suite.bundle("baseline"), suite.bundle("candidate"), "--output", suite.output]);
  assert.match(compared.stdout, /PASS baseline \(baseline system\)/);
  Object.assign(suite.meshes.candidate.adapters.adapter.options, { fail: "task" }); await suite.save(); await suite.run();
  await assert.rejects(exec(process.execPath, [cli, "compare", suite.bundle("baseline"), suite.bundle("candidate"), "--output", suite.output]), (error: unknown) => (error as { code: number; stdout: string }).code === 1 && /FAIL candidate/.test((error as { stdout: string }).stdout));
  const rendered = await exec(process.execPath, [cli, "render", join(suite.output, "bundle.json"), "--output", join(suite.directory, "published")]);
  assert.match(rendered.stdout, /Report: .*published\/index\.html/);
});
