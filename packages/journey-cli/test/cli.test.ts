import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { stringify } from "yaml";
import type { ReportModel, TestModel } from "@openuji/journey-reporter";
import { cli, suiteFixture } from "./suite-fixture.js";

const interpreter = fileURLToPath(new URL("./fixtures/interpreter.mjs", import.meta.url));
const exec = promisify(execFile);
const json = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;

const exitCode = (code: number) => (error: unknown) => (error as { code: number }).code === code;

test("test writes the run record, then the composition root derives the report with configured interpreters", async () => {
  const suite = await suiteFixture();
  const run = await exec(process.execPath, [cli, "test", suite.path], { cwd: tmpdir() });
  assert.match(run.stdout, /PASS sharing/);
  assert.match(run.stdout, /Run record: .*reports\/run\.json/);
  assert.match(run.stdout, /Report model: .*reports\/report\/report\.json/);
  const model = await json<ReportModel>(join(suite.output, "report/report.json"));
  assert.deepEqual(model.tests.map((test) => [test.id, test.ok, test.metricKinds]), [["sharing", true, ["fixture"]]]);
  const testModel = await json<TestModel>(join(suite.output, model.tests[0].href));
  assert.deepEqual(testModel.data.map((item) => [item.href, item.format]), [["report/data/sharing/fixture/fixture.json", "fixture/derived"]]);
  assert.deepEqual(testModel.profiles[0].steps.map((step) => step.metrics?.kind), ["fixture", "fixture"]);
  // Nothing renders: the CLI writes data only.
  await assert.rejects(access(join(suite.output, "index.html")));
});

test("exit codes: invalid configuration 2, failed tests 1, report failure with passing tests 3", async () => {
  const suite = await suiteFixture();
  assert.match((await exec(process.execPath, [cli, "validate", suite.path, "--test", "sharing"])).stdout, /Valid tests: sharing/);
  await assert.rejects(exec(process.execPath, [cli, "test", suite.path, "--test", "missing"]), exitCode(2));
  suite.config.report = { interpreters: [{ use: interpreter }], unknown: true }; await suite.save();
  await assert.rejects(exec(process.execPath, [cli, "validate", suite.path]), exitCode(2));
  await assert.rejects(access(join(suite.directory, "events.jsonl")));
  // An interpreter failure is a report warning: the verdict and exit code stay with execution.
  suite.config.report = { interpreters: [{ use: interpreter, options: { fail: true } }] }; await suite.save();
  const warned = await exec(process.execPath, [cli, "test", suite.path]);
  assert.match(warned.stdout, /PASS sharing/);
  assert.match(warned.stderr, /Report warning \(sharing\): .*Fixture interpretation failure/);
  const model = await json<ReportModel>(join(suite.output, "report/report.json"));
  assert.equal(model.ok, true);
  assert.equal(model.errors.length, 1);
  // A report that cannot be built at all exits 3 when every test passed.
  suite.config.report = { interpreters: [{ use: "./missing-interpreter.mjs" }] }; await suite.save();
  await assert.rejects(exec(process.execPath, [cli, "test", suite.path]), (error: unknown) => {
    const failure = error as { code: number; stdout: string; stderr: string };
    return failure.code === 3 && /PASS sharing/.test(failure.stdout) && /Report could not be built/.test(failure.stderr);
  });
  await access(join(suite.output, "run.json"));
  (suite.config.executors.first.options as Record<string, unknown>).fail = "alice";
  suite.config.report = { interpreters: [{ use: interpreter }] }; await suite.save();
  await assert.rejects(exec(process.execPath, [cli, "test", suite.path]), exitCode(1));
});

test("report rebuilds report/ from the run record alone, and export inlines it as one JSON value", async () => {
  const suite = await suiteFixture();
  await exec(process.execPath, [cli, "test", suite.path, "--no-report"]);
  await assert.rejects(access(join(suite.output, "report")));
  await exec(process.execPath, [cli, "report", suite.output, "--config", suite.path]);
  const model = await json<ReportModel>(join(suite.output, "report/report.json"));
  assert.equal(model.tests[0].id, "sharing");
  const exported = JSON.parse((await exec(process.execPath, [cli, "export", suite.output, "--data"])).stdout);
  assert.equal(exported.tests[0].format, "journey-mesh/report-model/test");
  assert.deepEqual(exported.tests[0].views["model.json"], { format: "fixture", document: { journeys: ["alice", "bob"] } });
  assert.deepEqual(exported.tests[0].data[0].value, { message: "fixture observation" });
  // Without a configuration, reports still build; they just have no interpreter data.
  await exec(process.execPath, [cli, "report", join(suite.output, "run.json")]);
  assert.deepEqual((await json<TestModel>(join(suite.output, "report/tests/sharing.json"))).data, []);
});

test("CLI interruption writes the run record after closing runtimes and fixtures", async () => {
  const suite = await suiteFixture();
  Object.assign(suite.config.executors.first.options, { delay: 500 }); await suite.save();
  const child = spawn(process.execPath, [cli, "test", suite.path], { stdio: ["ignore", "pipe", "pipe"] });
  const exit = new Promise<number | null>((done) => child.once("exit", done));
  try {
    let running = false;
    for (let count = 0; count < 200; count++) {
      try { running = (await suite.events()).some((event) => event.event === "state"); } catch {}
      if (running) break;
      await new Promise((done) => setTimeout(done, 10));
    }
    assert.equal(running, true); child.kill("SIGTERM"); assert.equal(await exit, 1);
    assert.equal((await suite.events()).at(-1)?.event, "teardown");
    assert.equal((await json<{ ok: boolean }>(join(suite.output, "run.json"))).ok, false);
  } finally { child.kill("SIGKILL"); }
});

test("missing device configuration identifies its test and suggests explicit selection without starting fixtures", async () => {
  const suite = await suiteFixture();
  const tests = suite.config.tests as Record<string, { journeys: object[]; profiles: object[] }>;
  tests.sharing.journeys = [{ id: "alice", source: "model.json", select: "alice", executor: "first" }];
  tests.sharing.profiles = [{ id: "default", journeys: { alice: "basic" } }];
  tests["device-required"] = { ...tests.sharing, journeys: [{ id: "bob", source: "model.json", select: "bob", executor: "second" }], profiles: [{ id: "device", journeys: { bob: "basic" } }] };
  Object.assign(suite.config.executors.second.options, { device: "${JOURNEY_TEST_REQUIRED_DEVICE}" });
  await suite.save();
  const env = { ...process.env };
  delete env.JOURNEY_TEST_REQUIRED_DEVICE;
  await assert.rejects(exec(process.execPath, [cli, "test", suite.path], { env }), (error: unknown) => {
    const failure = error as { code: number; stderr: string };
    assert.equal(failure.code, 2);
    assert.match(failure.stderr, /Configuration error in test "device-required"/);
    assert.match(failure.stderr, /Missing environment variable JOURNEY_TEST_REQUIRED_DEVICE/);
    assert.match(failure.stderr, /all configured tests must pass preflight\. No tests were started/);
    assert.match(failure.stderr, /journey-mesh test .* --test sharing/);
    return true;
  });
  await assert.rejects(access(join(suite.directory, "events.jsonl")));
  assert.match((await exec(process.execPath, [cli, "validate", suite.path, "--test", "sharing"], { env })).stdout, /Valid tests: sharing/);
});
