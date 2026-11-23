import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { executeSuite, prepareSuite, runSuite, validateSuite } from "../src/index.js";

const plugin = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url));
async function fixture(failService = false, failObserver = false) {
  const directory = await mkdtemp(join(tmpdir(), "runtime-observers-"));
  await writeFile(join(directory, "model.json"), JSON.stringify({ journeys: ["task"] }));
  const path = join(directory, "mesh.yaml");
  const config = { kind: "suite", model: { use: plugin("model") }, profiles: { default: { use: plugin("profile") } },
    runtimeObservers: [{ use: plugin("runtime-observer"), options: { fail: failObserver } }],
    services: { fixture: { use: plugin("observable-service"), options: { fail: failService } } },
    adapters: { web: { use: plugin("adapter"), options: { name: "web", log: "events.jsonl" } } },
    tests: { task: { services: ["fixture"], journeys: [{ id: "task", source: "model.json", select: "task", adapter: "web" }],
      profiles: [{ id: "default", journeys: { task: "default" } }] } } };
  await writeFile(path, stringify(config));
  return { path, directory, config };
}

test("runtime observers preflight without construction and are fresh for each execution of a prepared suite", async () => {
  const f = await fixture();
  const prepared = await prepareSuite(f.path);
  await assert.rejects(access(join(f.directory, "runtime-events")));
  for (const name of ["first", "second"]) {
    const run = await executeSuite(prepared, { outputDir: join(f.directory, name) });
    assert.equal(run.ok, true, JSON.stringify(run.errors));
    assert.deepEqual(run.files.map((file) => file.href), ["diagnostics/observer-01/fixture.json"]);
  }
  assert.deepEqual((await readFile(join(f.directory, "runtime-events"), "utf8")).trim().split("\n"),
    Array(2).fill(["observer-created", "captured", "disposed", "observer-closed"]).flat());
});

test("partial service startup failure is observed before compensation and still closes the collector", async () => {
  const f = await fixture(true);
  const run = await runSuite(f.path);
  assert.equal(run.ok, false);
  assert.match(run.errors[0].message, /startup failed/);
  assert.equal(run.files.length, 1);
  assert.deepEqual((await readFile(join(f.directory, "runtime-events"), "utf8")).trim().split("\n"),
    ["observer-created", "captured", "disposed", "observer-closed"]);
});

test("runtime capture failure is retained separately and cannot change a passing journey verdict or prevent disposal", async () => {
  const f = await fixture(false, true);
  const run = await runSuite(f.path);
  assert.equal(run.ok, true, JSON.stringify(run.errors));
  assert.deepEqual(run.files.map((file) => file.href), ["diagnostics/errors.json"]);
  const errors = JSON.parse(await readFile(join(f.directory, "test-results", "diagnostics", "errors.json"), "utf8"));
  assert.equal(errors[0].message, "runtime capture failed");
  assert.match(await readFile(join(f.directory, "runtime-events"), "utf8"), /captured\ndisposed\nobserver-closed/);
});

test("invalid runtime observer settings fail before resources or observer instances exist", async () => {
  const f = await fixture();
  await writeFile(f.path, stringify({ ...f.config, runtimeObservers: [{ use: plugin("runtime-observer"), options: { invalid: true } }] }));
  await assert.rejects(validateSuite(f.path), /invalid runtime observer/);
  await assert.rejects(access(join(f.directory, "runtime-events")));
});

test("the suite's runtimeObserverTimeoutMs releases a resource owner from an observer that asks to wait longer", async () => {
  const f = await fixture();
  await writeFile(f.path, stringify({ ...f.config, runtimeObserverTimeoutMs: 50, runtimeObservers: [{ use: plugin("runtime-observer"), options: { hang: true } }] }));
  const started = Date.now();
  const run = await runSuite(f.path);
  assert.ok(Date.now() - started < 30_000, "disposal waited for the observer's own hour-long timeout");
  assert.equal(run.ok, true, JSON.stringify(run.errors));
  assert.match(await readFile(join(f.directory, "runtime-events"), "utf8"), /captured\ndisposed\nobserver-closed/);
  const errors = JSON.parse(await readFile(join(f.directory, "test-results", "diagnostics", "errors.json"), "utf8"));
  assert.match(errors[0].message, /runtimeObserverTimeoutMs of 50ms/);
});

test("an invalid runtimeObserverTimeoutMs fails preflight", async () => {
  const f = await fixture();
  for (const value of [0, -5, 1.5, "soon"]) {
    await writeFile(f.path, stringify({ ...f.config, runtimeObserverTimeoutMs: value }));
    await assert.rejects(validateSuite(f.path), /runtimeObserverTimeoutMs must be a positive integer/);
  }
});

test("a partially started observer is detached immediately and does not affect other runtime observers", async () => {
  const f = await fixture();
  await writeFile(f.path, stringify({ ...f.config, runtimeObservers: [
    { use: plugin("runtime-observer"), options: { failStart: true } }, ...f.config.runtimeObservers
  ] }));
  const run = await runSuite(f.path);
  assert.equal(run.ok, true, JSON.stringify(run.errors));
  assert.deepEqual((await readFile(join(f.directory, "runtime-events"), "utf8")).trim().split("\n"),
    ["observer-created", "observer-closed", "observer-created", "captured", "disposed", "observer-closed"]);
  assert.deepEqual(run.files.map((file) => file.href), ["diagnostics/observer-02/fixture.json", "diagnostics/errors.json"]);
});
