/**
 * The command-line contract: what `journey-mesh --help` promises, checked against what the CLI does. Third-party
 * tools parse this output, so a failure here means either the behaviour or the contract changed by accident.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { stringify } from "yaml";
import { cli, suiteFixture } from "./suite-fixture.js";

const exec = promisify(execFile);
const contract = fileURLToPath(new URL("../contract/journey-mesh.help.txt", import.meta.url));
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const run = (args: readonly string[], cwd?: string) => exec(process.execPath, [cli, ...args], cwd ? { cwd } : {});
const fails = (args: readonly string[], code: number, stderr: RegExp) => assert.rejects(run(args), (error: unknown) => {
  const failure = error as { code: number; stderr: string };
  assert.equal(failure.code, code);
  assert.match(failure.stderr, stderr);
  return true;
});

test("--help matches contract/journey-mesh.help.txt (UPDATE_CLI_CONTRACT=1 pnpm test rewrites it)", async () => {
  const { stdout } = await run(["--help"]);
  if (process.env.UPDATE_CLI_CONTRACT) { await mkdir(dirname(contract), { recursive: true }); await writeFile(contract, stdout); }
  assert.equal(stdout, await readFile(contract, "utf8"));
});

test("exit 2: argument errors name the problem on their first line", async () => {
  await fails(["bogus"], 2, /^Unknown command "bogus"\. Run journey-mesh --help for the commands\.\n$/);
  await fails(["toString"], 2, /^Unknown command "toString"/);
  await fails(["services"], 2, /^Unknown command "services": use "services up" or "services down"\.\n$/);
  await fails(["services", "restart", "mesh.yaml"], 2, /^Unknown command "services restart": use "services up" or "services down"\./);
  await fails(["test"], 2, /^Missing arguments for test\.\nUsage: journey-mesh test <config\.yaml>/);
  await fails(["test", "a.yaml", "b.yaml"], 2, /^Unexpected argument "b\.yaml" for test\./);
  await fails(["test", "a.yaml", "--tset", "x"], 2, /^Unknown option --tset for test\./);
  await fails(["test", "a.yaml", "--test"], 2, /^Missing value for --test\./);
  await fails(["test", join(tmpdir(), "missing-mesh.yaml")], 2, /^No such configuration file: .*missing-mesh\.yaml\n$/);
});

test("exit 2: report and export name a directory that is not a run, or has no report yet", async () => {
  const empty = await mkdtemp(join(tmpdir(), "journey-cli-empty-"));
  await fails(["report", join(empty, "missing")], 2, /^Not a run directory: .*missing \(no run\.json\)\n$/);
  await fails(["report", empty], 2, /^Not a run directory/);
  await fails(["export", empty], 2, /^Not a run or comparison directory: .* \(no report\/report\.json\)\n$/);
  const suite = await suiteFixture();
  await run(["test", suite.path, "--no-report"]);
  await fails(["export", suite.output], 2, /has no report yet\. Build it with:\n {2}journey-mesh report /);
});

test("test: default output is test-results next to the YAML; prints PASS <id>, Run record and Report model", async () => {
  const suite = await suiteFixture();
  delete (suite.config as { outputDir?: string }).outputDir; await suite.save();
  const { stdout } = await run(["test", suite.path], tmpdir());
  const output = join(suite.directory, "test-results");
  assert.match(stdout, /^PASS sharing$/m);
  assert.match(stdout, new RegExp(`^Run record: ${literal(join(output, "run.json"))}$`, "m"));
  assert.match(stdout, new RegExp(`^Report model: ${literal(join(output, "report/report.json"))}$`, "m"));
});

test("validate: takes several configurations, prints Valid tests: <config>#<id>, and runs nothing", async () => {
  const [first, second] = [await suiteFixture(), await suiteFixture()];
  const { stdout } = await run(["validate", first.path, second.path]);
  assert.equal(stdout, `Valid tests: ${first.path}#sharing, ${second.path}#sharing\n`);
  for (const suite of [first, second]) await assert.rejects(access(join(suite.directory, "events.jsonl")));
});

test("report: exit 3 when the report cannot be built; without --config no interpreter runs", async () => {
  const suite = await suiteFixture();
  await run(["test", suite.path, "--no-report"]);
  const { stdout } = await run(["report", suite.output]);
  assert.match(stdout, /^Run record: .*\/run\.json$/m);
  assert.match(stdout, /^Report model: .*\/report\/report\.json$/m);
  assert.deepEqual(JSON.parse(await readFile(join(suite.output, "report/tests/sharing.json"), "utf8")).data, []);
  suite.config.report = { interpreters: [{ use: "./missing-interpreter.mjs" }] }; await suite.save();
  await fails(["report", suite.output, "--config", suite.path], 3, /^Report could not be built: /);
});

test("export: --output writes the file and prints Exported report: <path>", async () => {
  const suite = await suiteFixture();
  await run(["test", suite.path]);
  const target = join(suite.directory, "export.json");
  assert.equal((await run(["export", suite.output, "--output", target])).stdout, `Exported report: ${target}\n`);
  assert.equal(JSON.parse(await readFile(target, "utf8")).tests[0].id, "sharing");
});

test("compare: default output comparison-results; --pairings takes the documented YAML list; prints PASS per subject and Comparison", async () => {
  const [baseline, candidate] = [await suiteFixture({ label: "Baseline" }), await suiteFixture({ label: "Candidate" })];
  for (const suite of [baseline, candidate]) await run(["test", suite.path]);
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "journey-cli-compare-")));
  const pairings = join(cwd, "pairings.yaml");
  await writeFile(pairings, stringify([{ id: "same-purpose", baseline: { test: "sharing", profile: "default" }, candidate: { test: "sharing", profile: "default" } }]));
  const { stdout } = await run(["compare", baseline.output, candidate.output, "--pairings", pairings], cwd);
  assert.match(stdout, /^PASS baseline \(Baseline\)\nPASS candidate \(Candidate\)\n/);
  assert.match(stdout, new RegExp(`^Comparison: ${literal(join(cwd, "comparison-results/report/report.json"))}$`, "m"));
  const model = JSON.parse(await readFile(join(cwd, "comparison-results/report/report.json"), "utf8"));
  assert.deepEqual(model.comparison.pairings.map((pairing: { id: string }) => pairing.id), ["same-purpose"]);
});
