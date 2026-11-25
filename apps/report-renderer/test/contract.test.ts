/** The command-line contract of the renderer's scripts; CI jobs and third-party tools rely on it. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const contract = join(root, "contract/report-renderer.help.txt");
const script = (name: string, args: readonly string[]) => exec(process.execPath, ["--import", "tsx", join(root, `cli/${name}.ts`), ...args], { cwd: root });
const fails = (name: string, args: readonly string[], stderr: RegExp) => assert.rejects(script(name, args), (error: unknown) => {
  const failure = error as { code: number; stderr: string };
  assert.equal(failure.code, 2);
  assert.match(failure.stderr, stderr);
  return true;
});

test("--help matches contract/report-renderer.help.txt for every script (UPDATE_CLI_CONTRACT=1 pnpm test rewrites it)", async () => {
  const [serve, site, markdown] = await Promise.all(["serve", "site", "markdown"].map(async (name) => (await script(name, ["--help"])).stdout));
  if (process.env.UPDATE_CLI_CONTRACT) { await mkdir(dirname(contract), { recursive: true }); await writeFile(contract, serve); }
  assert.equal(serve, await readFile(contract, "utf8"));
  assert.equal(site, serve);
  assert.equal(markdown, serve);
});

test("exit 2: argument errors and a directory without a report are named before anything is served or written", async () => {
  const empty = await mkdtemp(join(tmpdir(), "renderer-contract-"));
  await fails("serve", [], /^Missing arguments for serve\.\nUsage: pnpm --filter @openuji\/report-renderer serve <run-directory>/);
  await fails("serve", [empty, "--prot", "9324"], /^Unknown option --prot for serve\./);
  await fails("serve", [empty, "--port", "99999"], /^--port must be a TCP port/);
  await fails("serve", [empty], /^No report model in .* \(no report\/report\.json\)\. Build it with journey-mesh report\./);
  await fails("site", [empty], /^Missing --out <directory> for site\./);
  await fails("site", [empty, "--out", join(empty, "site"), "--max-file-size-mib", "0"], /^--max-file-size-mib must resolve to a positive safe byte count/);
  await fails("markdown", [empty, "extra"], /^Unexpected argument "extra" for markdown\./);
  await fails("markdown", [empty], /^No report model in /);
});
