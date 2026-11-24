import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { compileUjgJourneyPlan } from "@openuji/journey-model-ujg";
import { validateSuite } from "@openuji/journey-host";

const example = new URL("../", import.meta.url);
const model = new URL("ujg/usertour.ujg.jsonld", example);

test("the tour journey observes the footer step, the orphaned step and the dismissed tour, with pointer activations", async () => {
  const plan = await compileUjgJourneyPlan(model, { journeyId: "urn:journey:scrolled-tour" });
  assert.deepEqual(plan.operations.map((operation) => operation.kind === "state" ? operation.state.id : operation.kind === "transition" ? operation.transition.id : operation.kind), [
    "urn:state:tour-footer-step", "urn:transition:tour-next", "urn:state:tour-orphaned-step", "urn:transition:tour-end", "urn:state:tour-ended"
  ]);
  assert.deepEqual([...new Set(plan.operations.flatMap((operation) => operation.entryBinding ? [operation.entryBinding.value] : []))], ["moodle.administration"]);
  const ended = plan.operations.at(-1)!;
  assert.equal(ended.kind === "state" && ended.target.expectedMatchCount, 0, "the dismissed tour is the orphaned dialog's absence");
});

test("the suite passes preflight without Docker: plugins, contracts, bindings and profiles", async () => {
  assert.deepEqual((await validateSuite(new URL("mesh.yaml", example).pathname, { env: {} })).tests, ["orphaned-step-viewport"]);
});

test("the fixture is the two-step tour of the upstream regression scenario", async () => {
  const tour = JSON.parse(await readFile(new URL("fixtures/scrolled-tour.json", example), "utf8"));
  assert.equal(tour.pathmatch, "/admin/search.php%");
  assert.deepEqual(tour.steps.map((step: { title: string; targettype: string; targetvalue: string }) => [step.title, step.targettype, step.targetvalue]),
    [["Page footer", "0", "#page-footer"], ["Orphaned step", "2", ""]]);
});

test("the example is configuration only, and every image is pinned by digest", async () => {
  assert.deepEqual((await readdir(example)).filter((name) => name.endsWith(".ts")), []);
  const images = [...(await readFile(new URL("mesh.yaml", example), "utf8")).matchAll(/Image: (\S+)/g), ...(await readFile(new URL("deployment/compose.yaml", example), "utf8")).matchAll(/image: (\S+)/g)]
    .map((match) => match[1]!).filter((image) => !image.startsWith("${"));
  assert.equal(images.length, 3);
  for (const image of images) assert.match(image, /@sha256:[a-f0-9]{64}$/);
});
