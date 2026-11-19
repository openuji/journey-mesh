import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReport, selectJourneyMaps } from "../src/index.js";
import { collectivesTest } from "./collectives-fixture.js";
import { fixtureConfig, suiteRun, writeRun } from "./fixtures.js";

test("phase selection hides only excluded journeys and preserves the record", async () => {
  const saved = await collectivesTest();
  const before = JSON.stringify(saved);
  const selection = selectJourneyMaps(saved, ["urn:phase:setup"]);
  assert.deepEqual(selection.errors, []);
  assert.deepEqual(selection.maps[0].segments.map((segment) => segment.id), ["sharing"]);
  assert.deepEqual(selection.maps[0].rootStartIds, ["urn:composite:collective-own:sharing"]);
  assert.equal(JSON.stringify(saved), before);
  assert.equal(selectJourneyMaps(saved).maps[0].rootStartIds.length, 2);
  assert.deepEqual(selectJourneyMaps(saved, ["urn:phase:setup", "urn:phase:sharing"]), { maps: [], errors: [] });
});

test("a broken map is a report error: the test verdict and execution evidence are unchanged", async () => {
  const saved = await collectivesTest();
  const document = saved.views.collectives.document as { steps: Record<string, { compositeStateRef: string }> };
  Object.values(document.steps)[0].compositeStateRef = "urn:missing";
  const selection = selectJourneyMaps(saved);
  assert.equal(selection.maps.length, 0);
  assert.match(selection.errors[0], /missing composite state urn:missing/);
  const directory = await writeRun(await mkdtemp(join(tmpdir(), "journey-map-errors-")), suiteRun([saved]));
  const record = await readFile(join(directory, "tests/collective-own/run.json"), "utf8");
  const { model, tests } = await buildReport(directory, { config: fixtureConfig() });
  assert.equal(model.ok, true);
  assert.equal(tests[0].ok, true);
  assert.deepEqual(tests[0].mapErrors, selection.errors);
  assert.deepEqual(model.errors, selection.errors.map((message) => ({ name: "JourneyMapError", message, test: "collective-own" })));
  assert.equal(await readFile(join(directory, "tests/collective-own/run.json"), "utf8"), record);
});

test("a missing discovery catalogue is an explicit map error, not inferred topology", async () => {
  const saved = await collectivesTest();
  delete (saved.views.collectives.document as { journeyEntryIndex?: unknown }).journeyEntryIndex;
  assert.match(selectJourneyMaps(saved).errors[0], /no root journey or JourneyEntryIndex/);
});
