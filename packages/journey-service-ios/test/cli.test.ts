import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);

test("iOS CI configuration check runs before workspace packages are built", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ios-check-unbuilt-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "mesh.yaml"), output = join(directory, "github-output");
  const component = { use: "not-loaded-during-configuration-check" };
  await writeFile(path, JSON.stringify({
    kind: "suite", model: component, executors: { stub: component }, profiles: { default: component },
    services: { ios: { ...component, options: { simulator: "journey-mesh-ios",
      deviceType: "iPhone 17", runtime: "26.2", locale: "en-US" } } },
    tests: { task: { journeys: [{ id: "task", source: "unused.json", select: "task", executor: "stub" }],
      profiles: [{ id: "default", journeys: { task: "default" } }] } }
  }));
  const result = await exec(process.execPath, [
    "--import", fileURLToPath(new URL("./fixtures/no-workspace-builds.mjs", import.meta.url)),
    fileURLToPath(new URL("../bin/journey-service-ios.mjs", import.meta.url)),
    "ios", "check", path, "--require-locale", "en-US", "--github-output"
  ], { env: { ...process.env, GITHUB_OUTPUT: output } });
  assert.match(result.stdout, /runtime and deviceType agree/);
  assert.equal(await readFile(output, "utf8"), "simulator=journey-mesh-ios\ndevice-type=iPhone 17\nruntime=26.2\n");
});
