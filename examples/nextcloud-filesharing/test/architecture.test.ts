import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { compileUjgJourneyPlan } from "@openuji/journey-model-ujg";
import { loadJourneyTestConfig, validateConfiguredTests } from "@openuji/journey-runtime";

const example = new URL("../", import.meta.url);

test("example delegates Nextcloud mechanics and retains only scenario configuration", async () => {
  const config = await readFile(new URL("mesh.yaml", example), "utf8");
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
  const config = new URL("../mesh.yaml", import.meta.url);
  assert.deepEqual((await validateConfiguredTests(config.pathname, { test: "browser-sharing", env: {} })).tests, ["browser-sharing"]);
  const loaded = await loadJourneyTestConfig(config.pathname, {});
  assert.equal(Object.keys(loaded.config.tests).length, 2);
  assert.deepEqual(loaded.config.envFiles?.filter((entry) => typeof entry === "object" && entry.path?.startsWith("./.runtime/")), [
    { path: "./.runtime/stack.env", optional: true },
    { path: "./.runtime/android.env", optional: true },
    { path: "./.runtime/appium.env", optional: true }
  ]);
  const legacy = await readdir(example);
  assert.ok(!legacy.includes("android.run.ts"));
  assert.ok(!legacy.includes("playwright.config.ts"));
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["android:local"], undefined);
  assert.match(packageJson.scripts["android:up"], /journey-mesh runtime up mesh\.yaml --runtime android/);
  assert.match(packageJson.scripts["appium:up"], /journey-mesh runtime up mesh\.yaml --runtime appium/);
});

test("example delegates Android/Appium infrastructure lifecycle to the owning packages", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  assert.ok(!("appium" in allDependencies));
  assert.ok(!("appium-uiautomator2-driver" in allDependencies));
  assert.ok(!("playwright" in allDependencies));
  assert.ok("@openuji/journey-driver-android" in packageJson.dependencies);
  assert.ok("@openuji/journey-adapter-appium" in packageJson.dependencies);
  assert.equal(packageJson.scripts["android:apk"], undefined);
  // Every lifecycle script that used to live here moved into the packages
  // that own it; nothing android-specific is left in the example itself.
  await assert.rejects(readdir(new URL("android/", example)), /ENOENT/);
});

test("Android device pins and the Nextcloud application config live in mesh.yaml, not a separate manifest", async () => {
  const config = new URL("../mesh.yaml", import.meta.url);
  const loaded = await loadJourneyTestConfig(config.pathname, {});
  const androidRuntime = loaded.config.runtimes?.android?.options as Record<string, unknown> | undefined;
  assert.ok(androidRuntime);
  assert.equal(androidRuntime?.api, 35);
  assert.equal(androidRuntime?.profile, "pixel_6");
  assert.ok(Array.isArray(androidRuntime?.requiredPackages));
  const androidAdapterOptions = loaded.config.adapters.android?.options as Record<string, unknown> | undefined;
  assert.ok(androidAdapterOptions?.application);
  assert.equal((androidAdapterOptions?.application as Record<string, unknown>).package, "com.nextcloud.client");
  assert.equal(androidAdapterOptions?.runtimeManifest, undefined);
});
