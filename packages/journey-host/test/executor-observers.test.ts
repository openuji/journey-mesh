import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { isolateObserver } from "../src/executor-observers.js";
import { runSuite } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url));

test("an executor observer that throws changes nothing a run does; what it threw fails the test", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-observers-"));
  await writeFile(join(directory, "model.json"), JSON.stringify({ journeys: ["first", "second"] }));
  await writeFile(join(directory, "mesh.yaml"), stringify({
    kind: "suite", outputDir: "results", model: { use: fixture("model") },
    executors: { web: { use: fixture("executor"), options: { name: "web", log: "events.jsonl" }, observers: [
      { use: fixture("throwing-observer"), options: { id: "broken", throws: true } },
      { use: fixture("throwing-observer"), options: { id: "other" } }
    ] } },
    profiles: { default: { use: fixture("profile") } },
    tests: { task: { journeys: ["first", "second"].map((id) => ({ id, source: "model.json", select: id, executor: "web" })), profiles: [{ id: "default", journeys: { first: "default", second: "default" } }] } }
  }));
  const run = await runSuite(join(directory, "mesh.yaml"));
  const record = run.tests[0]!;
  assert.equal(record.result.ok, true, "the run did what it would have done without the observer");
  assert.equal(record.result.evidence.executions[0]!.operations.length, 2);
  assert.equal(record.ok, false);
  assert.equal(run.ok, false);
  assert.deepEqual(record.observerErrors.map((error) => error.message),
    Array(2).fill("Observer executors.web.observers[0] threw in observeOperation: observer broke"));
  assert.deepEqual(record.observers.map((output) => [output.id, (output.evidence as { seen: string[] }).seen.length]), [["broken", 2], ["other", 2]]);
});

test("guarding keeps an observer's own state and getters, also when it is frozen or throws synchronously", async () => {
  class Counting {
    readonly name = "counting";
    count = 0;
    get seen() { return this.count; }
    onAction() { this.count++; throw new Error("sync"); }
    async observeOperation() { this.count++; throw new Error("async"); }
  }
  for (const observer of [new Counting(), Object.freeze({ name: "frozen", seen: 0, onAction() { throw new Error("sync"); }, async observeOperation() { throw new Error("async"); } })]) {
    const component = isolateObserver({ observer, output: () => ({ id: "id", kind: "kind", measurements: [], evidence: {}, errors: [] }) }, "label");
    const guarded = component.observer as Counting;
    assert.equal(guarded.name, observer.name);
    assert.equal(guarded.onAction(), undefined);
    await guarded.observeOperation();
    assert.equal(guarded.seen, observer instanceof Counting ? 2 : 0);
    assert.deepEqual(component.thrown().map((error) => error.message), ["Observer label threw in onAction: sync", "Observer label threw in observeOperation: async"]);
  }
});
