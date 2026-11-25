/** The command-line contract of journey-executor-appium; CI scripts and third-party tools rely on it. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const bin = fileURLToPath(new URL("../bin/journey-executor-appium.mjs", import.meta.url));
const contract = fileURLToPath(new URL("../contract/journey-executor-appium.help.txt", import.meta.url));
const fails = (args: readonly string[], stderr: RegExp) => assert.rejects(exec(process.execPath, [bin, ...args]), (error: unknown) => {
  const failure = error as { code: number; stderr: string };
  assert.equal(failure.code, 2);
  assert.match(failure.stderr, stderr);
  return true;
});

test("--help matches contract/journey-executor-appium.help.txt (UPDATE_CLI_CONTRACT=1 pnpm test rewrites it)", async () => {
  const { stdout } = await exec(process.execPath, [bin, "--help"]);
  if (process.env.UPDATE_CLI_CONTRACT) { await mkdir(dirname(contract), { recursive: true }); await writeFile(contract, stdout); }
  assert.equal(stdout, await readFile(contract, "utf8"));
});

test("exit 2: argument errors name the problem before starting anything", async () => {
  await fails(["serve"], /^Unknown command "serve"\. Run journey-executor-appium --help for the commands\./);
  await fails(["appium", "start"], /^Unknown command "appium start": use "appium serve" or "appium ensure-driver"\./);
  await fails(["appium", "serve", "--prot", "4723"], /^Unknown option --prot for appium serve\./);
  await fails(["appium", "serve", "--port"], /^Missing value for --port\./);
  await fails(["appium", "ensure-driver", "--force"], /^Unknown option --force for appium ensure-driver\./);
});
