/** The command-line contract of journey-service-ios; CI workflows and third-party tools rely on it. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const bin = fileURLToPath(new URL("../bin/journey-service-ios.mjs", import.meta.url));
const contract = fileURLToPath(new URL("../contract/journey-service-ios.help.txt", import.meta.url));
const fails = (args: readonly string[], code: number, stderr: RegExp) => assert.rejects(exec(process.execPath, [bin, ...args]), (error: unknown) => {
  const failure = error as { code: number; stderr: string };
  assert.equal(failure.code, code);
  assert.match(failure.stderr, stderr);
  return true;
});

test("--help matches contract/journey-service-ios.help.txt (UPDATE_CLI_CONTRACT=1 pnpm test rewrites it)", async () => {
  const { stdout } = await exec(process.execPath, [bin, "--help"]);
  if (process.env.UPDATE_CLI_CONTRACT) { await mkdir(dirname(contract), { recursive: true }); await writeFile(contract, stdout); }
  assert.equal(stdout, await readFile(contract, "utf8"));
});

test("exit 2 for argument errors, exit 1 when the configuration fails the check", async () => {
  await fails(["ios", "verify", "mesh.yaml"], 2, /^Unknown command "ios verify": use "ios check"\./);
  await fails(["ios", "check"], 2, /^Missing arguments for ios check\.\nUsage: journey-service-ios ios check <config\.yaml>/);
  await fails(["ios", "check", "mesh.yaml", "--service"], 2, /^Missing value for --service\./);
  await fails(["ios", "check", "mesh.yaml", "--locale", "en-US"], 2, /^Unknown option --locale for ios check\./);
  await fails(["ios", "check", fileURLToPath(new URL("./missing.yaml", import.meta.url))], 1, /missing\.yaml/);
});
