import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReader } from "@openuji/journey-run-record/node";
import { buildReport, exportReport, jsonReader, loadReportModel, type TestModel } from "../src/index.js";
import { collectivesTest } from "./collectives-fixture.js";
import { fixtureConfig, savedTest, suiteRun, writeRun } from "./fixtures.js";

const temporary = (name: string) => mkdtemp(join(tmpdir(), `${name}-`));
const json = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;

test("the report model joins plan, execution, interpreter metrics and evidence for templates", async () => {
  const directory = await writeRun(await temporary("report-model"), suiteRun([await collectivesTest(), savedTest()], { label: "Fixture system" }));
  const { model } = await buildReport(directory, { config: fixtureConfig({ excludedPhaseIds: ["urn:phase:setup"] }), generatedAt: "2026-11-19T12:00:00.000Z" });
  assert.equal(model.format, "journey-mesh/report-model");
  assert.equal(model.label, "Fixture system");
  assert.equal(model.ok, false);
  assert.deepEqual(model.tests.map((item) => [item.id, item.ok, item.href, item.metricKinds]), [
    ["collective-own", true, "report/tests/collective-own.json", ["axe", "skipped"]],
    ["manual-plan", false, "report/tests/manual-plan.json", []]
  ]);
  const collectives = await json<TestModel>(join(directory, model.tests[0].href));
  assert.deepEqual(collectives.views.collectives.format, "journey-map");
  await access(join(directory, collectives.views.collectives.href));
  assert.deepEqual(collectives.maps.map((map) => [map.view, map.segments, map.rootStartIds]), [["collectives", ["sharing"], ["urn:composite:collective-own:sharing"]]]);
  assert.deepEqual(Object.values(collectives.maps[0].touchpoints), [["web"]]);
  const profile = collectives.profiles.find((item) => item.id === "default")!;
  const states = Object.values(profile.mapStates.collectives);
  assert.ok(states.length > 0 && states.every((state) => state.outcome === "passed"));
  assert.equal(states.filter((state) => state.metrics?.kind === "axe").length, 2);
  assert.ok(profile.steps.some((step) => step.excluded && step.phaseId === "urn:phase:setup"));
  // Manual plan: screenshots belong to the exact run and execution; outcomes and failures are explicit.
  const manual = await json<TestModel>(join(directory, model.tests[1].href));
  const steps = manual.profiles[0].steps;
  assert.deepEqual(steps.map((step) => [step.id, step.outcome, step.screenshots.map((file) => file.href)]), [
    ["first-occurrence", "passed", ["tests/manual-plan/files/right.png"]],
    ["second-occurrence", "failed", []]
  ]);
  assert.equal(steps[1].error, "Completion failed");
  assert.deepEqual(manual.failures, [{ name: "Error", message: "Failure", source: "execution" }]);
  assert.deepEqual(manual.profiles[0].error, { name: "Error", message: "Failure" });
  // Every href resolves inside the run directory.
  const hrefs = JSON.stringify(manual).match(/"href":"[^"]+"/g)!.map((item) => item.slice(8, -1));
  for (const href of hrefs) if (!href.includes("wrong")) await access(join(directory, href));
});

test("interpreter failures are report errors: verdict and run record are untouched, other tests still report", async () => {
  const failing = { ...savedTest(), id: "failing", observers: [{ id: "broken", kind: "fixture-nodes", measurements: [], errors: [], evidence: { fail: true } }] };
  const directory = await writeRun(await temporary("report-errors"), suiteRun([failing, await collectivesTest()]));
  const record = await readFile(join(directory, "run.json"), "utf8");
  const { model } = await buildReport(directory, { config: fixtureConfig() });
  assert.deepEqual(model.errors.map((error) => [error.name, error.test]), [["InterpreterError", "failing"]]);
  assert.match(model.errors[0].message, /could not interpret observer broken: Fixture interpreter failure/);
  assert.deepEqual(model.tests.map((item) => item.ok), [false, true]);
  assert.deepEqual(model.tests[1].metricKinds, ["axe", "skipped"]);
  assert.equal(await readFile(join(directory, "run.json"), "utf8"), record);
});

test("observers without an interpreter still report their measurements; nothing in report/ is HTML", async () => {
  const directory = await writeRun(await temporary("report-plain"), suiteRun([await collectivesTest()]));
  const { tests } = await buildReport(directory);
  assert.equal(tests[0].profiles[0].steps.every((step) => !step.metrics), true);
  const files = await readdir(join(directory, "report"), { recursive: true });
  assert.ok(files.every((file) => !file.endsWith(".html")));
});

test("rebuilding replaces report/ atomically, and a failed build keeps the previous report", async () => {
  const directory = await writeRun(await temporary("report-rebuild"), suiteRun([savedTest()]));
  await buildReport(directory, { config: fixtureConfig() });
  await writeFile(join(directory, "report/stale.json"), "{}");
  await buildReport(directory, { config: fixtureConfig() });
  await assert.rejects(access(join(directory, "report/stale.json")));
  const before = await readFile(join(directory, "report/report.json"), "utf8");
  await assert.rejects(buildReport(directory, { config: fixtureConfig({ interpreters: [{ use: "./missing.mjs" }] }) }), /Cannot find|ERR_MODULE_NOT_FOUND|missing/);
  assert.equal(await readFile(join(directory, "report/report.json"), "utf8"), before);
});

test("the loader and export give templates the same model, with snapshots and data inlined on request", async () => {
  const saved = await collectivesTest();
  const collectives = { ...saved, observers: [{ ...saved.observers[0], evidence: { ...(saved.observers[0].evidence as object), data: [{ name: "summary.json", format: "fixture/summary", label: "Fixture summary", value: { total: 3 } }] } }] };
  const directory = await writeRun(await temporary("report-export"), suiteRun([collectives]));
  await buildReport(directory, { config: fixtureConfig() });
  const report = await loadReportModel(jsonReader(runReader(directory)));
  const loaded = await report.loadTest("collective-own");
  assert.deepEqual(loaded.data.map((item) => [item.href, item.format, item.label, item.observer]), [["report/data/collective-own/axe/summary.json", "fixture/summary", "Fixture summary", "axe"]]);
  const exported = await exportReport(directory, { data: true });
  assert.equal(exported.tests[0].views.collectives.format, "journey-map");
  assert.deepEqual(exported.tests[0].data[0].value, { total: 3 });
  assert.equal((await exportReport(directory)).tests[0].data[0].value, undefined);
  await assert.rejects(loadReportModel(jsonReader(runReader(await temporary("no-report")))), /ENOENT/);
});
