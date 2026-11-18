import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);

test("Android CI configuration check runs before workspace packages are built", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "android-check-unbuilt-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "mesh.yaml"), output = join(directory, "github-output");
  const component = { use: "not-loaded-during-configuration-check" };
  await writeFile(path, JSON.stringify({
    kind: "suite", model: component, adapters: { stub: component }, profiles: { default: component },
    services: { android: { ...component, options: { api: 35, avd: "journey-mesh-api35",
      image: "system-images;android-35;google_apis;x86_64", profile: "pixel_6", locale: "en-US" } } },
    tests: { task: { journeys: [{ id: "task", source: "unused.json", select: "task", adapter: "stub" }],
      profiles: [{ id: "default", journeys: { task: "default" } }] } }
  }));
  const result = await exec(process.execPath, [
    "--import", fileURLToPath(new URL("./fixtures/no-workspace-builds.mjs", import.meta.url)),
    fileURLToPath(new URL("../bin/journey-driver-android.mjs", import.meta.url)),
    "android", "check", path, "--require-locale", "en-US", "--github-output"
  ], { env: { ...process.env, GITHUB_OUTPUT: output } });
  assert.match(result.stdout, /API level and system image agree/);
  assert.equal(await readFile(output, "utf8"), "api-level=35\ntarget=google_apis\narch=x86_64\nprofile=pixel_6\n");
});
