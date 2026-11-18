import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectJourneyMaps } from "../src/journey-maps.js";
import { publishReport, writeReport, readReport } from "../src/publish.js";
import { collectivesTest } from "./collectives-fixture.js";

test("mixed-document phase selection hides only excluded journeys and preserves the model and execution", async () => {
  const saved = await collectivesTest();
  const before = JSON.stringify(saved);
  const selection = selectJourneyMaps(saved);
  assert.deepEqual(selection.errors, []);
  assert.deepEqual(selection.maps[0].segments.map((segment) => segment.id), ["sharing"]);
  assert.deepEqual(selection.maps[0].rootStartIds, ["urn:composite:collective-own:sharing"]);
  assert.equal(JSON.stringify(saved), before);
  assert.equal(selectJourneyMaps({ ...saved, report: { excludedPhaseIds: [] } }).maps[0].rootStartIds.length, 2);
  assert.deepEqual(selectJourneyMaps({ ...saved, report: { excludedPhaseIds: ["urn:phase:setup", "urn:phase:sharing"] } }), { maps: [], errors: [] });
});

test("bad map references become saved reporting errors while execution and audits remain intact", async () => {
  const saved = await collectivesTest();
  const document = saved.views.collectives.document as { steps: Record<string, { compositeStateRef: string }> };
  Object.values(document.steps)[0].compositeStateRef = "urn:missing";
  const selection = selectJourneyMaps(saved);
  assert.equal(selection.maps.length, 0);
  assert.match(selection.errors[0].message, /missing composite state urn:missing/);
  const directory = await mkdtemp(join(tmpdir(), "journey-map-errors-"));
  await writeReport(directory, { kind: "suite", ok: true, generatedAt: "now", tests: [saved], artifacts: [], errors: [] });
  const bundle = await readReport(directory, ["suite"]);
  assert.equal(bundle.ok, false);
  assert.equal(bundle.tests[0].result.ok, true);
  assert.deepEqual(bundle.tests[0].outputs, saved.outputs);
  assert.deepEqual(bundle.tests[0].reportingErrors, selection.errors);
  const republished = await publishReport(join(directory, "manifest.json"));
  assert.equal(republished.ok, false);
  assert.equal(republished.kind, "suite");
  if (republished.kind === "suite") assert.deepEqual(republished.tests[0].reportingErrors, selection.errors);
});

test("a missing discovery catalogue is an explicit report-contract error, not inferred topology", async () => {
  const saved = await collectivesTest();
  delete (saved.views.collectives.document as { journeyEntryIndex?: unknown }).journeyEntryIndex;
  assert.match(selectJourneyMaps(saved).errors[0].message, /no root journey or JourneyEntryIndex/);
});
