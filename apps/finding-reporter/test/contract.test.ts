/** The command-line contract of the finding reporter; agent skills and CI jobs rely on it. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { runDirectory, runWithoutFindings, targetMissing } from "./fixture.js";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const contract = join(root, "contract/finding-reporter.help.txt");
const bundle = (args: readonly string[]) => exec(process.execPath, ["--import", "tsx", join(root, "cli/bundle.ts"), ...args], { cwd: root, env: { ...process.env, INIT_CWD: root } });
const fails = (args: readonly string[], stderr: RegExp) => assert.rejects(bundle(args), (error: unknown) => {
  const failure = error as { code: number; stderr: string };
  assert.equal(failure.code, 2, failure.stderr);
  assert.match(failure.stderr, stderr);
  return true;
});

test("--help matches contract/finding-reporter.help.txt (UPDATE_CLI_CONTRACT=1 pnpm test rewrites it)", async () => {
  const { stdout } = await bundle(["--help"]);
  if (process.env.UPDATE_CLI_CONTRACT) { await mkdir(dirname(contract), { recursive: true }); await writeFile(contract, stdout); }
  assert.equal(stdout, await readFile(contract, "utf8"));
});

test("exit 2: argument errors, a missing report, missing findings data and an unknown finding", async () => {
  const empty = await mkdtemp(join(tmpdir(), "finding-reporter-contract-"));
  const out = join(empty, "out");
  await fails([], /^Missing arguments for bundle\.\nUsage: pnpm --filter @openuji\/finding-reporter bundle <run-directory>/);
  await fails([empty], /^Missing --out <directory> for bundle\./);
  await fails([empty, "--out", out, "--fidning", "x"], /^Unknown option --fidning for bundle\./);
  // Findings come from the model; there is no findings file to pass.
  await fails([empty, "--out", out, "--findings", "findings.yaml"], /^Unknown option --findings for bundle\./);
  await fails([empty, "--out", out], /^No report model in .* \(no report\/report\.json\)\. Build it with journey-mesh report\./);
  await fails([await runWithoutFindings(), "--out", out], /^No findings data in .*: run the tests with @openuji\/journey-observer-findings, and build the report with @openuji\/journey-report-findings in report\.interpreters\./);
  const run = await runDirectory([targetMissing]);
  await fails([run, "--out", out, "--finding", "nope"], /^Unknown finding nope; this run has page-arrange--data-widget-form/);
  assert.deepEqual(await readdir(empty).then((items) => items.filter((item) => item === "out")), [], "nothing is written before the arguments hold");
});

test("exit 0 with only the Findings line when the run has no findings: an index, and no bundle", async () => {
  const out = join(await mkdtemp(join(tmpdir(), "finding-reporter-out-")), "findings");
  const { stdout } = await bundle([await runDirectory([]), "--out", out]);
  assert.equal(stdout, `Findings: ${join(out, "index.md")}\n`);
  assert.deepEqual(await readdir(out), ["index.md"]);
});
