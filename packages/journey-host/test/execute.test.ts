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
import { readReport } from "@openuji/journey-reporter";
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

test("service provenance and artifacts reach the suite bundle with relative hrefs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-services-"));
  await writeFile(join(directory, "model.json"), JSON.stringify({ journeys: ["task"] }));
  await writeFile(join(directory, "mesh.yaml"), stringify({
    kind: "suite", label: "Fixture system", outputDir: "results", model: { use: fixture("model") },
    services: { stack: { use: fixture("service"), options: { name: "stack", log: "events.jsonl", identity: { version: "1.2.3" } } } },
    adapters: { adapter: { use: fixture("adapter"), options: { name: "adapter", log: "events.jsonl" } } },
    profiles: { default: { use: fixture("profile") } },
    tests: { task: { services: ["stack"], journeys: [{ id: "task", source: "model.json", select: "task", adapter: "adapter" }], profiles: [{ id: "default", journeys: { task: "default" } }] } }
  }));
  const bundle = await runSuite(join(directory, "mesh.yaml"));
  assert.equal(bundle.ok, true);
  assert.equal(bundle.label, "Fixture system");
  assert.deepEqual(bundle.provenance, { stack: { version: "1.2.3" } });
  assert.deepEqual(bundle.artifacts.map((artifact) => artifact.href), ["services/stack/stack.identity.json"]);
  // The model's drawable view is embedded in the bundle and referenced by each journey segment.
  assert.deepEqual(bundle.tests[0].segments, [{ id: "task", journeyId: "task", adapter: "adapter", view: "model.json" }]);
  assert.deepEqual(bundle.tests[0].views, { "model.json": { format: "fixture", document: { journeys: ["task"] } } });
  const saved = await readReport(join(directory, "results"), ["suite"]);
  assert.deepEqual(saved.provenance, bundle.provenance);
  // Saved bundles are publishable: no local absolute path survives anywhere in them.
  const absolute: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string" && (value.startsWith("/") || value.includes(directory))) absolute.push(path);
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
  };
  walk(saved, "bundle");
  assert.deepEqual(absolute, []);
});
