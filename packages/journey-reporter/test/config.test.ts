import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { excludedPhasesFor, loadInterpreters, loadReportConfig, parseReportConfig } from "../src/index.js";
import { nodeInterpreter } from "./fixtures.js";

test("report sections parse with suite defaults and per-test overrides", () => {
  const config = parseReportConfig({ report: { excludedPhaseIds: ["urn:phase:setup"], interpreters: [{ use: "./x.mjs", options: { a: 1 } }] },
    tests: { sharing: { report: { excludedPhaseIds: [] } }, other: { journeys: [] } } });
  assert.deepEqual(excludedPhasesFor(config, "sharing"), []);
  assert.deepEqual(excludedPhasesFor(config, "other"), ["urn:phase:setup"]);
  assert.deepEqual(config.interpreters, [{ use: "./x.mjs", options: { a: 1 } }]);
  assert.deepEqual(parseReportConfig({}).interpreters, []);
});

test("unknown or invalid report settings are rejected; execution settings are ignored", () => {
  assert.throws(() => parseReportConfig({ report: { unknown: true } }), /Unknown setting report.unknown/);
  // Hosting is a renderer concern, not report data.
  assert.throws(() => parseReportConfig({ report: { maxFileSizeMiB: 5 } }), /Unknown setting report.maxFileSizeMiB/);
  assert.throws(() => parseReportConfig({ tests: { sharing: { report: { maxFileSizeMiB: 10 } } } }), /Unknown setting tests.sharing.report.maxFileSizeMiB/);
  assert.throws(() => parseReportConfig({ report: { interpreters: [{ options: {} }] } }), /report.interpreters\[0\].use/);
  assert.doesNotThrow(() => parseReportConfig({ kind: "suite", adapters: { anything: {} }, tests: { a: { journeys: [] } } }));
});

test("interpreters load relative to the configuration and validate their exports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "report-config-"));
  await writeFile(join(directory, "not-an-interpreter.mjs"), "export const journeyMeshPlugin = {};");
  await writeFile(join(directory, "mesh.yaml"), stringify({ kind: "suite", report: { interpreters: [{ use: "./not-an-interpreter.mjs" }] } }));
  await assert.rejects(loadInterpreters(await loadReportConfig(join(directory, "mesh.yaml"))), /must export journeyMeshInterpreter/);
  await writeFile(join(directory, "mesh.yaml"), stringify({ kind: "suite", report: { interpreters: [{ use: nodeInterpreter }] } }));
  const [loaded] = await loadInterpreters(await loadReportConfig(join(directory, "mesh.yaml")));
  assert.equal(loaded.definition.kind, "fixture-nodes");
});
