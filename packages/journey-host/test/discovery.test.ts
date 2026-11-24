import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import type { DiscoveredMaterialization } from "@openuji/journey-plugin";
import { declareFindings, executeSuite, JourneyConfigError, prepareSuite, runSuite } from "../src/index.js";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url));
const journey = (id: string, executor: string) => ({ id, source: "${FIXTURE_MODEL:-model.json}", select: id, executor });
const ignore = { rediscover: false, record() {} };

/** A suite with one executor that has a discovery mode (`web`) and one that has none (`android`). */
async function suite(tests: Record<string, unknown>, model = "model") {
  const directory = await mkdtemp(join(tmpdir(), "journey-discovery-"));
  await writeFile(join(directory, "model.json"), JSON.stringify({ journeys: ["web", "android"] }));
  const path = join(directory, "mesh.yaml");
  await writeFile(path, stringify({
    kind: "suite", outputDir: "results", model: { use: fixture(model) },
    executors: {
      web: { use: fixture("discovery-executor"), options: { name: "web" }, observers: [{ use: fixture("executor-observer") }] },
      android: { use: fixture("executor"), options: { name: "android", log: "android.jsonl" } }
    },
    profiles: { default: { use: fixture("profile") }, discovery: { use: fixture("mode-profile") } },
    tests
  }));
  return { directory, path };
}

test("a discovery run builds each executor's discovery mode without observers, and findings carry their test", async () => {
  const { path } = await suite({ pages: { journeys: [journey("web", "web")], profiles: [{ id: "first", journeys: { web: "discovery" } }, { id: "second", journeys: { web: "discovery" } }] } });
  const found: DiscoveredMaterialization[] = [];
  const prepared = await prepareSuite(path, { profile: "second", discovery: { rediscover: true, record(finding) { found.push(finding); } } });
  const run = await executeSuite(prepared);
  assert.equal(run.ok, true, JSON.stringify(run.errors));
  assert.deepEqual(found.map((finding) => [finding.testId, finding.profileId, JSON.parse(finding.note!)]), [["pages", "second", { mode: "discovery", rediscover: true, observers: 0 }]]);
  assert.deepEqual(run.tests[0].observers, []);
  // The run mode is what lets profiles relax: the same profile cannot be built for a test run.
  await assert.rejects(runSuite(path), /profile built outside a discovery run/);
});

test("a test with a journey on an executor without a discovery mode is rejected before anything starts, and still runs as a test", async () => {
  const { directory, path } = await suite({ mixed: { journeys: [journey("web", "web"), journey("android", "android")], profiles: [{ id: "default", journeys: { web: "default", android: "default" } }] } });
  await assert.rejects(prepareSuite(path, { discovery: ignore }), (error) => error instanceof JourneyConfigError && error.testId === "mixed"
    && /journeys android run on executor android \(.*executor\.mjs\), which has no discovery mode/.test(error.message));
  await assert.rejects(readFile(join(directory, "android.jsonl"), "utf8"), { code: "ENOENT" });
  const run = await runSuite(path);
  assert.equal(run.ok, true, JSON.stringify(run.errors));
  assert.match(await readFile(join(directory, "android.jsonl"), "utf8"), /"event":"start"/);
});

test("a profile combination the test does not have is a configuration error", async () => {
  const { path } = await suite({ pages: { journeys: [journey("web", "web")], profiles: [{ id: "default", journeys: { web: "default" } }] } });
  await assert.rejects(prepareSuite(path, { profile: "missing", discovery: ignore }), (error) => error instanceof JourneyConfigError && /Test pages has no profile combination missing/.test(error.message));
});

test("findings are declared through the suite's model plugin, which returns documents and writes nothing", async () => {
  const tests = { pages: { journeys: [journey("web", "web")], profiles: [{ id: "default", journeys: { web: "default" } }] } };
  const finding: DiscoveredMaterialization = { testId: "pages", profileId: "default", operationId: "op", transitionId: "urn:transition", modalityId: "observability:keyboard", status: "found", steps: [] };
  const { directory, path } = await suite(tests, "declaring-model");
  const original = await readFile(join(directory, "model.json"), "utf8");
  const [declared] = await declareFindings(path, [finding]);
  assert.equal(basename(declared.source), "model.json");
  assert.match(declared.document ?? "", /1 declared/);
  assert.deepEqual(declared.writes.map((write) => write.outcome), ["added"]);
  assert.equal(await readFile(join(directory, "model.json"), "utf8"), original);

  const plain = await suite(tests);
  await assert.rejects(declareFindings(plain.path, [finding]), (error) => error instanceof JourneyConfigError && /cannot declare discovered steps/.test(error.message));
});
