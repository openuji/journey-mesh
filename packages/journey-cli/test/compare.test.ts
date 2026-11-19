import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { stringify } from "yaml";
import { runSuite } from "@openuji/journey-host";
import { buildReport, compareRuns, loadReportConfig, type ReportModel } from "@openuji/journey-reporter";

const cli = fileURLToPath(new URL("../bin/journey-mesh.mjs", import.meta.url));
const exec = promisify(execFile);
const fixture = (name: string) => fileURLToPath(new URL(`../../journey-host/test/fixtures/${name}.mjs`, import.meta.url));
const interpreter = fileURLToPath(new URL("./fixtures/interpreter.mjs", import.meta.url));

/** Two ordinary suites; a comparison only ever sees their run directories. */
async function setup(baselineIds = ["task", "default"], candidateIds = ["task", "default"]) {
  const directory = await mkdtemp(join(tmpdir(), "journey-comparison-"));
  const mesh = (side: string, [testId, profile]: string[]) => ({
    kind: "suite", label: `${side} system`, outputDir: `${side}-results`, model: { use: fixture("model") },
    adapters: { adapter: { use: fixture("adapter"), options: { name: side, log: "events.jsonl" } as Record<string, unknown>, observers: [{ use: fixture("observer") }] } },
    profiles: { default: { use: fixture("profile") } },
    report: { interpreters: [{ use: interpreter }] },
    tests: { [testId]: { journeys: [{ id: "task", source: "model.json", select: testId, adapter: "adapter" }], profiles: [{ id: profile, journeys: { task: "default" } }] } }
  });
  const meshes = { baseline: mesh("baseline", baselineIds), candidate: mesh("candidate", candidateIds) };
  await writeFile(join(directory, "model.json"), JSON.stringify({ journeys: [...new Set([baselineIds[0], candidateIds[0]])] }));
  const save = async () => { for (const side of ["baseline", "candidate"] as const) await writeFile(join(directory, `${side}.yaml`), stringify(meshes[side])); };
  await save();
  const run = (side: "baseline" | "candidate") => join(directory, `${side}-results`);
  const runAll = async () => {
    for (const side of ["baseline", "candidate"] as const) {
      await runSuite(join(directory, `${side}.yaml`));
      await buildReport(run(side), { config: await loadReportConfig(join(directory, `${side}.yaml`)) });
    }
  };
  return { directory, meshes, save, runAll, run, output: join(directory, "comparison") };
}

test("runs pair by test and profile ID; subjects keep their records, evidence and reports", async () => {
  const suite = await setup(); await suite.runAll();
  const result = await compareRuns({ baseline: suite.run("baseline"), candidate: suite.run("candidate"), outputDir: suite.output, title: "Release check" });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "comparison");
  assert.deepEqual(result.comparison!.pairings.map((pairing) => [pairing.baseline.test, pairing.candidate.profile]), [["task", "default"]]);
  assert.equal(result.comparison!.subjects.baseline.label, "baseline system");
  assert.equal(result.comparison!.subjects.candidate.directory, "subjects/candidate");
  for (const side of ["baseline", "candidate"] as const) {
    assert.equal(await readFile(join(suite.output, `subjects/${side}/tests/task/files/fixture-evidence.txt`), "utf8"), "fixture observation");
    // A subject keeps the report it was built with, including interpreter data.
    await access(join(suite.output, `subjects/${side}/report/data/task/fixture/fixture.json`));
  }
  const saved = JSON.parse(await readFile(join(suite.output, "report/report.json"), "utf8")) as ReportModel;
  assert.equal(saved.comparison!.title, "Release check");
  await assert.rejects(access(join(suite.output, "index.html")));
});

test("different test and profile IDs need explicit pairings", async () => {
  const suite = await setup(["first-journey", "pointer"], ["different-journey", "keyboard"]); await suite.runAll();
  const inferred = await compareRuns({ baseline: suite.run("baseline"), candidate: suite.run("candidate"), outputDir: suite.output });
  assert.ok(inferred.comparison!.pairings.every((pairing) => !pairing.baseline.test || !pairing.candidate.test));
  const pairings = [{ id: "same-purpose", baseline: { test: "first-journey", profile: "pointer" }, candidate: { test: "different-journey", profile: "keyboard" } }];
  const explicit = await compareRuns({ baseline: suite.run("baseline"), candidate: suite.run("candidate"), outputDir: suite.output, pairings });
  assert.deepEqual(explicit.comparison!.pairings, pairings);
  await assert.rejects(compareRuns({ baseline: suite.run("baseline"), candidate: suite.run("candidate"), outputDir: suite.output, pairings: [{ ...pairings[0], candidate: { test: "missing", profile: "keyboard" } }] }), /Unknown candidate selection/);
});

test("a failed subject keeps its evidence; a missing subject is reported without hiding the other", async () => {
  const suite = await setup(); Object.assign(suite.meshes.baseline.adapters.adapter.options, { fail: "task" }); await suite.save(); await suite.runAll();
  const result = await compareRuns({ baseline: suite.run("baseline"), candidate: suite.run("candidate"), outputDir: suite.output });
  assert.equal(result.ok, false);
  assert.equal(result.comparison!.subjects.baseline.ok, false);
  assert.equal(result.comparison!.subjects.candidate.ok, true);
  assert.match(await readFile(join(suite.output, "subjects/baseline/tests/task/run.json"), "utf8"), /Fixture state failure/);
  const missing = await compareRuns({ baseline: suite.run("baseline"), candidate: join(suite.directory, "never-ran"), outputDir: suite.output });
  assert.equal(missing.comparison!.subjects.candidate.directory, null);
  assert.match(missing.comparison!.subjects.candidate.errors[0].message, /ENOENT/);
});

test("a run record with an escaping evidence reference is refused and the previous publication is kept", async () => {
  const suite = await setup(); await suite.runAll();
  const record = join(suite.run("baseline"), "tests/task/run.json");
  const saved = JSON.parse(await readFile(record, "utf8"));
  saved.files.push({ name: "escape", href: "../secret", contentType: "text/plain" });
  await writeFile(record, JSON.stringify(saved));
  await mkdir(suite.output); await writeFile(join(suite.output, "retained.txt"), "previous valid publication");
  await assert.rejects(compareRuns({ baseline: suite.run("baseline"), candidate: suite.run("candidate"), outputDir: suite.output }), /Invalid run record reference/);
  assert.equal(await readFile(join(suite.output, "retained.txt"), "utf8"), "previous valid publication");
  await assert.rejects(compareRuns({ baseline: suite.run("candidate"), candidate: suite.run("candidate"), outputDir: suite.run("candidate") }), /contains its source/);
});

test("CLI preflights every subject before running, and compare exits nonzero for failed subjects", async () => {
  const suite = await setup();
  const paths = ["baseline", "candidate"].map((side) => join(suite.directory, `${side}.yaml`));
  assert.match((await exec(process.execPath, [cli, "validate", ...paths])).stdout, /Valid tests: .*baseline\.yaml#task, .*candidate\.yaml#task/);
  suite.meshes.candidate.tests.task.journeys[0].select = "missing"; await suite.save();
  await assert.rejects(exec(process.execPath, [cli, "validate", ...paths]), (error: unknown) => (error as { code: number }).code === 2);
  await assert.rejects(access(join(suite.directory, "events.jsonl")));
  suite.meshes.candidate.tests.task.journeys[0].select = "task"; await suite.save(); await suite.runAll();
  const compared = await exec(process.execPath, [cli, "compare", suite.run("baseline"), join(suite.run("candidate"), "run.json"), "--output", suite.output]);
  assert.match(compared.stdout, /PASS baseline \(baseline system\)/);
  assert.match(compared.stdout, /Comparison: .*comparison\/report\/report\.json/);
  Object.assign(suite.meshes.candidate.adapters.adapter.options, { fail: "task" }); await suite.save(); await suite.runAll();
  await assert.rejects(exec(process.execPath, [cli, "compare", suite.run("baseline"), suite.run("candidate"), "--output", suite.output]),
    (error: unknown) => (error as { code: number; stdout: string }).code === 1 && /FAIL candidate/.test((error as { stdout: string }).stdout));
});
