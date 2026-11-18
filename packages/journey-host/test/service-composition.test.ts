import assert from "node:assert/strict";
import { test } from "node:test";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { runSuite, validateSuite } from "../src/index.js";
const plugin = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url));
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "service-outputs-"));
  await writeFile(join(directory, "model.json"), JSON.stringify({ journeys: ["task"] }));
  const config = { kind: "suite", target: { service: "install", output: "identity" },
    model: { use: plugin("model") }, profiles: { default: { use: plugin("profile") } },
    adapters: { web: { use: plugin("adapter"), options: { name: "web", log: "events.jsonl" } } },
    services: {
      install: { use: plugin("install-service"), inputs: { source: { service: "source", output: "source" } }, options: { fail: false } },
      source: { use: plugin("source-service"), options: { headFile: "head" } }
    }, tests: { task: { services: ["install"], journeys: [{ id: "task", source: "model.json", select: "task", adapter: "web" }],
      profiles: [{ id: "default", journeys: { task: "default" } }] } } };
  await writeFile(join(directory, "head"), "a".repeat(40));
  const path = join(directory, "mesh.yaml");
  const save = () => writeFile(path, stringify(config)); await save();
  return { path, directory, config, save };
}
test("service outputs follow PR identity through installation and stay out of the bundle", async () => {
  const s = await setup(); await validateSuite(s.path); await assert.rejects(access(join(s.directory, "events")));
  for (const sha of ["a".repeat(40), "b".repeat(40)]) {
    await writeFile(join(s.directory, "head"), sha);
    const result = await runSuite(s.path);
    assert.equal(result.ok, true); assert.equal(result.target?.sourceSha, sha);
    assert.equal(result.target?.version, "1.0"); assert.ok(!JSON.stringify(result).includes("/runtime-only"));
  }
  assert.deepEqual((await readFile(join(s.directory, "events"), "utf8")).trim().split("\n"),
    Array(2).fill(["source-up", "install-up", "install-down", "source-down"]).flat());
});
test("incompatible output references fail before startup", async () => {
  const s = await setup(); s.config.services.install.inputs.source.output = "identity"; await s.save();
  await assert.rejects(validateSuite(s.path), /incompatible service input/);
  await assert.rejects(access(join(s.directory, "events")));
});
test("failed installation cleans up attempted services in reverse order", async () => {
  const s = await setup(); s.config.services.install.options.fail = true; await s.save();
  const result = await runSuite(s.path); assert.equal(result.ok, false); assert.equal(result.target, undefined);
  assert.deepEqual((await readFile(join(s.directory, "events"), "utf8")).trim().split("\n"), ["source-up", "install-up", "install-down", "source-down"]);
});
