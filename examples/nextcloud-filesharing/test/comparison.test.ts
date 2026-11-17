import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileUjgJourneyPlan } from "@openuji/journey-model-ujg";
import { validateConfiguredTests } from "@openuji/journey-runtime";
// Example authoring and deployment helpers deliberately have no runtime side effects.
// @ts-expect-error JavaScript authoring helper has no declaration file.
import { syncModels } from "../comparison/models.mjs";
import {
  comparisonEnvironment,
  comparisonProcessEnvironment,
  composeArguments,
} from "../comparison/deployment.mjs";

const example = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("comparison/manifest.json", example), "utf8"),
);

test("explicit comparison values override ambient service configuration without mutation", () => {
  const parent = Object.freeze({ PATH: "/tools", NEXTCLOUD_ALICE_URL: "https://unrelated.example" });
  const env = comparisonProcessEnvironment(parent, "NEXTCLOUD_ALICE_URL=http://192.0.2.30:18181\n", { NEXTCLOUD_STACK_PROJECT: "isolated" });
  assert.equal(env.NEXTCLOUD_ALICE_URL, "http://192.0.2.30:18181");
  assert.equal(env.PATH, "/tools");
  assert.equal(parent.NEXTCLOUD_ALICE_URL, "https://unrelated.example");
});

test("comparison models are synchronized and enter All files through the existing compiler", async () => {
  await syncModels(true);
  for (const variant of manifest.variants) {
    const plan = await compileUjgJourneyPlan(new URL(variant.model, example), {
      journeyId: "urn:journey:bob-remote-share",
    });
    assert.equal(plan.operations[0].entryBinding?.value, "nextcloud.files");
    assert.equal(
      plan.operations[0].source?.references?.graphNodeId,
      variant.id === "nc34" ? "urn:state:bob-files-list-ready" : "urn:state:bob-all-files-ready",
    );
    assert.ok(Object.isFrozen(plan.operations));
    const inputs = plan.operations.filter(
      (op) =>
        op.kind === "transition" &&
        op.activation.requiredInputModalityProfiles.length,
    );
    assert.equal(inputs.length, variant.id === "nc34" ? 4 : 1);
    if (variant.id === "pr66147") {
      assert.deepEqual(plan.operations.filter((op) => op.kind === "state").map((op) => op.source?.references?.graphNodeId), [
        "urn:state:bob-all-files-ready",
        "urn:state:bob-shared-report-visible",
      ]);
      const final = plan.operations.at(-1)!;
      assert.equal(final.kind, "state");
      assert.equal(final.target.bindings[0]?.locators[0]?.role, "row");
    }
    assert.ok(!plan.operations.some((op) => /decline|reject/i.test(op.id)));
  }
});

test("comparison stacks isolate projects, ports, and federation addresses", async () => {
  const defaults = await readFile(
    new URL("deployment/.env.example", example),
    "utf8",
  );
  const before = JSON.stringify(manifest);
  const environments = manifest.variants.map((variant: any) =>
    comparisonEnvironment(defaults, variant),
  );
  assert.match(
    environments[0],
    /bob@http:\/\/host\.docker\.internal:18082/,
  );
  assert.match(
    environments[1],
    /bob@http:\/\/host\.docker\.internal:18182/,
  );
  assert.match(
    environments[1],
    /NEXTCLOUD_ALICE_URL=http:\/\/host\.docker\.internal:18181/,
  );
  assert.match(
    environments[1],
    /NEXTCLOUD_STACK_PROJECT=journey-comparison-pr66147/,
  );
  assert.equal(JSON.stringify(manifest), before);
  assert.deepEqual(composeArguments("project", "/env", "/compose"), [
    "compose",
    "--project-name",
    "project",
    "--env-file",
    "/env",
    "-f",
    "/compose",
  ]);
});

test("comparison preflights without devices and keeps measurements optional", async () => {
  const env = {
    NEXTCLOUD_STACK_ENV_FILE: new URL("deployment/.env.example", example)
      .pathname,
    NEXTCLOUD_COMPARISON_MODEL: manifest.variants[0].model,
    NEXTCLOUD_COMPARISON_OUTPUT_DIR: ".tmp/preflight",
  };
  assert.deepEqual(
    (
      await validateConfiguredTests(
        new URL("comparison.mesh.yaml", example).pathname,
        { env },
      )
    ).tests,
    ["browser-sharing"],
  );
  const source = await readFile(
    new URL("comparison.mesh.yaml", example),
    "utf8",
  );
  assert.match(source, /@openuji\/journey-observer-ux\/plugin/);
  assert.doesNotMatch(source, /appium|android|runtime:/);
});
