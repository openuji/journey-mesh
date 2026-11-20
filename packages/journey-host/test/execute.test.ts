import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import type { JourneyObserverComponent } from "@openuji/journey-plugin";
import type { JourneyObserverOutput, JourneyMeasurement } from "@openuji/journey-core";
import type { RunResult } from "@openuji/journey-runner";
import { readRunRecord } from "@openuji/journey-run-record/node";
import { collectObserverOutputs, runSuite } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url));
const result = { ok: true, runId: "run", plan: { id: "plan" }, errors: [], assessments: [], executions: [{ executionId: "execution", profileId: "default", outcome: { kind: "passed" } }], evidence: { executions: [] } } as unknown as RunResult;
const metric = (overrides: Partial<JourneyMeasurement> = {}): JourneyMeasurement => ({ id: "effort", label: "Effort", method: "count", unit: "command", aggregation: "count", status: "available", value: 1, scope: { runId: "run", executionId: "execution", profileId: "default", operationIds: [] }, ...overrides });
const observer = (output: () => unknown): JourneyObserverComponent => ({ observer: {}, output: async () => output() as JourneyObserverOutput });
const valid = (id: string, measurements = [metric()]) => ({ id, kind: "custom", measurements, evidence: {}, errors: [] });

test("observer outputs are checked against the run and failures never hide other outputs", async () => {
  const { outputs, errors } = await collectObserverOutputs([
    observer(() => valid("first")),
    observer(() => { throw new Error("observer crashed"); }),
    observer(() => ({ id: "broken" })),
    observer(() => valid("first")),
    observer(() => valid("foreign", [metric({ scope: { runId: "another-run", executionId: "execution", profileId: "default", operationIds: [] } })])),
    observer(() => valid("twice", [metric(), metric()])),
    observer(() => valid("infinite", [metric({ value: Number.POSITIVE_INFINITY })])),
    observer(() => valid("last"))
  ], result);
  assert.deepEqual(outputs.map((output) => output.id), ["first", "last"]);
  assert.deepEqual(errors.map((error) => error.message), [
    "observer crashed", "Invalid observer output", "Duplicate observer output first", "Measurement effort does not match the execution", "Duplicate measurement effort", "Measurements must be finite"
  ]);
  assert.ok(Object.isFrozen(outputs[0]));
});

test("service provenance and evidence reach the run record with relative hrefs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-services-"));
  await writeFile(join(directory, "model.json"), JSON.stringify({ journeys: ["task"] }));
  await writeFile(join(directory, "mesh.yaml"), stringify({
    kind: "suite", label: "Fixture system", outputDir: "results", model: { use: fixture("model") },
    services: { stack: { use: fixture("service"), options: { name: "stack", log: "events.jsonl", identity: { version: "1.2.3" } } } },
    adapters: { adapter: { use: fixture("adapter"), options: { name: "adapter", log: "events.jsonl" } } },
    profiles: { default: { use: fixture("profile") } },
    tests: { task: { services: ["stack"], journeys: [{ id: "task", source: "model.json", select: "task", adapter: "adapter" }], profiles: [{ id: "default", journeys: { task: "default" } }] } }
  }));
  const run = await runSuite(join(directory, "mesh.yaml"));
  assert.equal(run.ok, true);
  assert.equal(run.label, "Fixture system");
  assert.deepEqual(run.provenance, { stack: { version: "1.2.3" } });
  assert.deepEqual(run.files.map((file) => file.href), ["services/stack/stack.identity.json"]);
  // The model document snapshot is recorded with the run and referenced by each journey segment.
  assert.deepEqual(run.tests[0].segments, [{ id: "task", journeyId: "task", adapter: "adapter", view: "model.json" }]);
  assert.deepEqual(run.tests[0].views, { "model.json": { format: "fixture", document: { journeys: ["task"] } } });
  const saved = await readRunRecord(join(directory, "results"));
  assert.deepEqual(saved.provenance, run.provenance);
  assert.ok(saved.startedAt <= saved.finishedAt);
  // Run records are portable: no local absolute path survives anywhere in them.
  const absolute: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string" && (value.startsWith("/") || value.includes(directory))) absolute.push(path);
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
  };
  walk(saved, "run");
  assert.deepEqual(absolute, []);
});

test("recorded observer outputs keep only contract fields, so no presentation data enters the run record", async () => {
  const { outputs } = await collectObserverOutputs([observer(() => ({ ...valid("extra"), nodes: [{ executionId: "execution", operationId: "op", metrics: { kind: "axe" } }], html: "<p>" }))], result);
  assert.deepEqual(Object.keys(outputs[0]).sort(), ["errors", "evidence", "id", "kind", "measurements"]);
});

test("evidence written by a service before failed startup remains in the failed run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-failed-service-"));
  const path = join(directory, "mesh.yaml");
  await writeFile(join(directory, "model.json"), JSON.stringify({ journeys: ["task"] }));
  await writeFile(path, stringify({
    kind: "suite", model: { use: fixture("model") },
    services: { stack: { use: fixture("service"), options: { name: "stack", log: "events.jsonl", failUp: true, identity: { version: "failed-start" } } } },
    adapters: { adapter: { use: fixture("adapter"), options: { name: "adapter", log: "events.jsonl" } } },
    profiles: { default: { use: fixture("profile") } },
    tests: { task: { services: ["stack"], journeys: [{ id: "task", source: "model.json", select: "task", adapter: "adapter" }], profiles: [{ id: "default", journeys: { task: "default" } }] } }
  }));
  const run = await runSuite(path);
  assert.equal(run.ok, false); assert.equal(run.tests.length, 0);
  assert.match(run.errors[0].message, /up failure/);
  assert.deepEqual(run.files.map((file) => file.href), ["services/stack/stack.identity.json"]);
});
