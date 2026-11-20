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
test("an unselected target fails preflight even when no services are selected", async () => {
  const s = await setup(); s.config.tests.task.services = []; await s.save();
  await assert.rejects(validateSuite(s.path), /target must reference a source-identity output of a selected service/);
  await assert.rejects(access(join(s.directory, "events")));
});
test("a suite without a target or selected services does not load unrelated services", async () => {
  const s = await setup(); s.config.tests.task.services = [];
  s.config.services.source.use = "missing-unselected-service";
  await writeFile(s.path, stringify({ ...s.config, target: undefined }));
  assert.deepEqual(await validateSuite(s.path), { tests: ["task"] });
  await assert.rejects(access(join(s.directory, "events")));
});
test("failed installation cleans up attempted services in reverse order", async () => {
  const s = await setup(); s.config.services.install.options.fail = true; await s.save();
  const result = await runSuite(s.path); assert.equal(result.ok, false); assert.equal(result.target, undefined);
  assert.deepEqual((await readFile(join(s.directory, "events"), "utf8")).trim().split("\n"), ["source-up", "install-up", "install-down", "source-down"]);
});

async function inputSetup() {
  const s = await setup();
  const adapters = s.config.adapters as Record<string, unknown>;
  adapters.native = { use: plugin("input-adapter"), inputs: { installed: { service: "install", output: "identity" } } };
  // The adapter input alone selects the installation and its source.
  Object.assign(s.config.tests.task, { services: [], journeys: [{ id: "task", source: "model.json", select: "task", adapter: "native" }] });
  await s.save();
  return s;
}
test("adapter inputs start their services and are readable once an execution starts", async () => {
  const s = await inputSetup();
  const result = await runSuite(s.path);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.target?.sourceSha, "a".repeat(40));
  assert.deepEqual((await readFile(join(s.directory, "events"), "utf8")).trim().split("\n"), [
    "source-up", "install-up",
    "configured: installed", `installed: ${"a".repeat(40)}`,
    "install-down", "source-down"
  ]);
});
test("adapter inputs with an incompatible contract or undeclared name fail preflight", async () => {
  const s = await inputSetup();
  Object.assign(s.config, { target: undefined });
  const adapters = s.config.adapters as unknown as Record<string, { inputs: Record<string, unknown> }>;
  adapters.native.inputs.installed = { service: "source", output: "source" }; await s.save();
  await assert.rejects(validateSuite(s.path), /incompatible adapter input adapters\.native\.inputs\.installed/);
  adapters.native.inputs = { other: { service: "install", output: "identity" } }; await s.save();
  await assert.rejects(validateSuite(s.path), /adapters\.native\.inputs\.other is not an input of this plugin/);
  adapters.native.inputs = { installed: { service: "missing", output: "identity" } }; await s.save();
  await assert.rejects(validateSuite(s.path), /references unknown service missing/);
  await assert.rejects(access(join(s.directory, "events")));
});
test("optional service inputs may be omitted but are still contract-checked", async () => {
  const s = await setup();
  const services = s.config.services as Record<string, Record<string, unknown>>;
  services.combine = { use: plugin("optional-input-service"), inputs: { source: { service: "source", output: "source" } } };
  Object.assign(s.config, { target: { service: "combine", output: "identity" } });
  s.config.tests.task.services = ["combine"]; await s.save();
  assert.equal((await runSuite(s.path)).ok, true);
  assert.match(await readFile(join(s.directory, "events"), "utf8"), /combine-up sibling=no/);
  (services.combine.inputs as Record<string, unknown>).sibling = { service: "source", output: "identity" }; await s.save();
  await assert.rejects(validateSuite(s.path), /incompatible service input services\.combine\.inputs\.sibling/);
  (services.combine.inputs as Record<string, unknown>).sibling = { service: "source", output: "source" }; await s.save();
  assert.equal((await runSuite(s.path)).ok, true);
  assert.match(await readFile(join(s.directory, "events"), "utf8"), /combine-up sibling=yes/);
});

test("a prepared suite can run twice with fresh inputs, components and evidence stores", async () => {
  const { prepareSuite, executeSuite } = await import("../src/index.js");
  const s = await inputSetup();
  const prepared = await prepareSuite(s.path);
  assert.ok(Object.isFrozen(prepared.loaded.config));
  assert.equal("set" in prepared.tests[0].compiled.segments, false);
  const first = await executeSuite(prepared, { outputDir: join(s.directory, "first") });
  await writeFile(join(s.directory, "head"), "c".repeat(40));
  const second = await executeSuite(prepared, { outputDir: join(s.directory, "second") });
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  assert.equal(first.target?.sourceSha, "a".repeat(40));
  assert.equal(second.target?.sourceSha, "c".repeat(40));
  const events = await readFile(join(s.directory, "events"), "utf8");
  assert.match(events, new RegExp(`installed: ${"a".repeat(40)}`));
  assert.match(events, new RegExp(`installed: ${"c".repeat(40)}`));
});

test("a returned service lease is registered before declared outputs are validated", async () => {
  const s = await setup();
  Object.assign(s.config.services.source.options, { missingOutput: true }); await s.save();
  const result = await runSuite(s.path);
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /did not produce output source/);
  assert.deepEqual((await readFile(join(s.directory, "events"), "utf8")).trim().split("\n"), ["source-up", "source-down"]);
});

test("all runtime tests are constructed before the first fixture or execution", async () => {
  const s = await inputSetup();
  Object.assign(s.config.adapters, { broken: { use: plugin("input-adapter"), options: { failConstruction: true } } });
  Object.assign(s.config.tests, { later: { ...s.config.tests.task, journeys: [{ id: "later", source: "model.json", select: "task", adapter: "broken" }], profiles: [{ id: "default", journeys: { later: "default" } }] } });
  await s.save();
  const result = await runSuite(s.path);
  assert.equal(result.ok, false); assert.equal(result.tests.length, 0);
  assert.match(result.errors[0].message, /output-dependent construction failure/);
  assert.deepEqual((await readFile(join(s.directory, "events"), "utf8")).trim().split("\n"), ["source-up", "install-up", "install-down", "source-down"]);
});
