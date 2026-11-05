import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { compileUjgJourneyPlan } from "@openuji/journey-model-ujg";
import { loadJourneyTestConfig, validateConfiguredTests } from "@openuji/journey-runtime";

const example = new URL("../", import.meta.url);

test("example delegates Nextcloud mechanics and retains only scenario configuration", async () => {
  const config = await readFile(new URL("journey.yaml", example), "utf8");
  assert.match(config, /@openuji\/journey-driver-nextcloud\/federated-sharing\/plugin/);
  assert.match(config, /shareCreated: urn:effect:alice-confirm-share/);
  assert.match(config, /shareAccepted: urn:effect:bob-accept-share/);
  assert.ok(!(await readdir(example)).includes("environment.ts"));
});

test("example pins its Nextcloud deployment image to a versioned digest", async () => {
  const compose = await readFile(new URL("deployment/compose.yaml", example), "utf8");
  const image = "nextcloud:34.0.2-apache@sha256:e93ccfc952c95f18175f3d297fb2f60c35070c05ca976050c250a9ddab793e75";
  assert.equal(compose.split(image).length - 1, 2);
  assert.doesNotMatch(compose, /nextcloud:stable-apache/);
});

test("native scenario enters the application and models notification navigation", async () => {
  const plan = await compileUjgJourneyPlan(new URL("../ujg/filesharing.android.ujg.jsonld", import.meta.url), {
    journeyId: "urn:journey:bob-remote-share"
  });
  assert.ok(plan.operations.some((operation) => operation.entryBinding?.value === "nextcloud.android.application"));
  assert.ok(plan.operations.some((operation) => operation.source?.references?.graphNodeId === "urn:transition:bob-opens-native-notifications"));
  assert.ok(Object.isFrozen(plan.operations));
});

test("browser selection validates without Android device or APK configuration", async () => {
  const config = new URL("../journey.yaml", import.meta.url);
  assert.deepEqual((await validateConfiguredTests(config.pathname, { test: "browser-sharing", env: {} })).tests, ["browser-sharing"]);
  const loaded = await loadJourneyTestConfig(config.pathname, {});
  assert.equal(Object.keys(loaded.config.tests).length, 2);
  const legacy = await readdir(example);
  assert.ok(!legacy.includes("android.run.ts"));
  assert.ok(!legacy.includes("playwright.config.ts"));
});
