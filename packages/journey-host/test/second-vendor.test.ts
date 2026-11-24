import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { stringify } from "yaml";
import { validateSuite } from "@openuji/journey-host";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url));
const playwright = resolve(root, "packages/journey-executor-playwright/src/plugin.ts");

async function suite(client: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), "second-vendor-"));
  await writeFile(join(directory, "model.json"), JSON.stringify({ journeys: ["learner"] }));
  await writeFile(join(directory, "mesh.yaml"), stringify({
    kind: "suite", model: { use: fixture("web-model") }, profiles: { basic: { use: fixture("profile") } },
    executors: { web: { use: playwright, client } },
    tests: { enrol: { journeys: [{ id: "learner", source: "model.json", select: "learner", executor: "web" }], profiles: [{ id: "default", journeys: { learner: "basic" } }] } }
  }));
  return join(directory, "mesh.yaml");
}

test("a second vendor's Web client composes with the Playwright executor through the Web client contract alone", async () => {
  const path = await suite({ use: fixture("example-vendor-web-client"), options: { baseURL: "https://moodle.example" } });
  // Preflight loads the executor and the client, checks their client contract, and resolves every operation's entry.
  assert.deepEqual(await validateSuite(path), { tests: ["enrol"] });
  const { journeyMeshPlugin } = await import(fixture("example-vendor-web-client"));
  const client = journeyMeshPlugin.create({ baseURL: "https://moodle.example/" });
  assert.deepEqual(client.resolveEntry({ entryBinding: { id: "binding", value: "2" } }), { kind: "url", url: "https://moodle.example/course/2" });
});

test("a client is rejected by an executor whose client contract it does not implement", async () => {
  const path = await suite({ use: fixture("example-vendor-web-client"), options: { baseURL: "https://moodle.example" } });
  const android = await suite({ use: resolve(root, "packages/journey-vendor-nextcloud/src/android/plugin.ts"), options: {} });
  await assert.doesNotReject(validateSuite(path));
  await assert.rejects(validateSuite(android), /client contract @openuji\/journey-platform-android\/client\/v1 is incompatible with @openuji\/journey-platform-web\/client\/v1/);
});
