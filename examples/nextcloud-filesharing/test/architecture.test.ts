import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { compileUjgJourneyPlan } from "@openuji/journey-model-ujg";
import { interpolate, loadSuiteConfig, validateSuite } from "@openuji/journey-host";

const example = new URL("../", import.meta.url);

test("example delegates Nextcloud mechanics and retains only scenario configuration", async () => {
  const config = await readFile(new URL("mesh.yaml", example), "utf8");
  assert.match(config, /@openuji\/journey-driver-nextcloud\/federated-sharing\/plugin/);
  assert.match(config, /shareCreated: urn:effect:alice-confirm-share/);
  assert.match(config, /shareAccepted: urn:effect:bob-accept-share/);
  assert.ok(!(await readdir(example)).includes("environment.ts"));
});

test("example pins its Nextcloud deployment image to a versioned digest", async () => {
  const { config } = await loadSuiteConfig(new URL("mesh.yaml", example).pathname, {});
  const compose = await readFile(new URL("deployment/compose.yaml", example), "utf8");
  const image = "nextcloud:34.0.2-apache@sha256:e93ccfc952c95f18175f3d297fb2f60c35070c05ca976050c250a9ddab793e75";
  for (const key of ["web-stack", "android-stack"]) {
    assert.equal(config.services[key].use, "@openuji/journey-driver-nextcloud/stack/service");
    assert.equal(config.services[key].options.image, image);
    assert.equal(config.services[key].options.expectedVersion, "34.0.2");
  }
  assert.equal(compose.split("image: ${NEXTCLOUD_IMAGE:?").length - 1, 2);
  assert.doesNotMatch(compose, /image: nextcloud:/);
});

test("native scenario enters Files explicitly and models notification navigation", async () => {
  const plan = await compileUjgJourneyPlan(new URL("../ujg/filesharing.android.ujg.jsonld", import.meta.url), {
    journeyId: "urn:journey:bob-remote-share"
  });
  assert.deepEqual([...new Set(plan.operations.flatMap((operation) => operation.entryBinding ? [operation.entryBinding.value] : []))], ["nextcloud.android.files"]);
  assert.ok(plan.operations.some((operation) => operation.source?.references?.graphNodeId === "urn:transition:bob-opens-native-notifications"));
  assert.ok(Object.isFrozen(plan.operations));
});

test("browser selection validates without Android device or APK configuration", async () => {
  const config = new URL("../mesh.yaml", import.meta.url);
  assert.deepEqual((await validateSuite(config.pathname, { test: "browser-sharing", env: {} })).tests, ["browser-sharing"]);
  const loaded = await loadSuiteConfig(config.pathname, {});
  assert.equal(loaded.config.tests.length, 2);
  assert.deepEqual(loaded.config.envFiles.filter((entry) => entry.path?.startsWith("./.runtime/")), [
    { path: "./.runtime/android.env", optional: true },
    { path: "./.runtime/appium.env", optional: true }
  ]);
  const legacy = await readdir(example);
  assert.ok(!legacy.includes("android.run.ts"));
  assert.ok(!legacy.includes("playwright.config.ts"));
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["android:local"], undefined);
  assert.match(packageJson.scripts["android:up"], /journey-mesh services up mesh\.yaml --service android/);
  assert.match(packageJson.scripts["appium:up"], /journey-mesh services up mesh\.yaml --service appium/);
});

test("tests select isolated packaged stacks and leave native infrastructure separately managed", async () => {
  const { config, env } = await loadSuiteConfig(new URL("mesh.yaml", example).pathname, {
    NEXTCLOUD_ANDROID_STACK_HOST: "192.0.2.40"
  });
  assert.deepEqual(config.tests.map((entry) => entry.services), [["web-stack"], ["android-stack"]]);
  const web = interpolate(config.services["web-stack"].options, env, "web-stack");
  const native = interpolate(config.services["android-stack"].options, env, "android-stack");
  assert.notEqual(web.project, native.project);
  assert.notEqual(web.directory, native.directory);
  const ports = [web.environment, native.environment].flatMap((value) => {
    const environment = value as Record<string, string>;
    return [environment.NEXTCLOUD_ALICE_PORT, environment.NEXTCLOUD_BOB_PORT];
  });
  assert.equal(new Set(ports).size, 4);
  assert.deepEqual(config.envFiles.map((entry) => entry.path), [
    "./deployment/.env.example", "./deployment/.env", "./.runtime/android.env", "./.runtime/appium.env"
  ]);
});

test("native selection requires a host and shares overridden URLs and accounts across components", async () => {
  const path = new URL("mesh.yaml", example).pathname;
  const { config } = await loadSuiteConfig(path, {});
  // Check the native URLs independently of a developer's optional .env file.
  const stackEnvironment = config.services["android-stack"].options.environment as Record<string, string>;
  assert.throws(() => interpolate(stackEnvironment.NEXTCLOUD_ALICE_HOST, {}, "android-stack"), /NEXTCLOUD_ANDROID_STACK_HOST/);
  await assert.rejects(validateSuite(path, { test: "native-recipient-sharing", env: { NEXTCLOUD_ANDROID_STACK_HOST: "", ANDROID_UDID: "emulator-5554" } }), /NEXTCLOUD_ANDROID_STACK_HOST/);
  const { env } = await loadSuiteConfig(path, {
    NEXTCLOUD_ANDROID_STACK_HOST: "192.0.2.40", NEXTCLOUD_ANDROID_ALICE_PORT: "19083", NEXTCLOUD_ANDROID_BOB_PORT: "19084",
    NEXTCLOUD_BOB_USER: "custom-bob", NEXTCLOUD_BOB_PASSWORD: "custom-password", ANDROID_UDID: "emulator-5554"
  });
  assert.deepEqual((await validateSuite(path, { test: "native-recipient-sharing", env: { ...env } })).tests, ["native-recipient-sharing"]);
  const stack = interpolate(config.services["android-stack"].options, env, "android-stack") as {
    environment: Record<string, string>; services: Record<string, { baseURL: string; username: string; password: string }>;
  };
  const environment = interpolate(config.tests[1].environment!.options, env, "environment") as {
    sharerTouchpoint: { baseURL: string }; recipientTouchpoint: { baseURL: string }; recipientUser: { username: string; password: string };
  };
  assert.equal(stack.environment.NEXTCLOUD_ALICE_URL, "http://192.0.2.40:19083");
  assert.equal(stack.environment.NEXTCLOUD_BOB_URL, "http://192.0.2.40:19084");
  assert.equal(environment.sharerTouchpoint.baseURL, stack.services.alice.baseURL);
  assert.equal(environment.recipientTouchpoint.baseURL, stack.services.bob.baseURL);
  for (const name of ["web-native", "android"]) {
    const driver = interpolate(config.adapters[name].driver!.options, env, name) as {
      touchpoints: Record<string, { baseURL: string }>; users: Record<string, { username: string; password: string }>;
      entries: Record<string, unknown>;
      transitionValues: Record<string, unknown>;
    };
    assert.equal(driver.touchpoints["urn:touchpoint:nextcloud-a"].baseURL, environment.sharerTouchpoint.baseURL);
    assert.equal(driver.touchpoints["urn:touchpoint:nextcloud-b"].baseURL, environment.recipientTouchpoint.baseURL);
    assert.equal(driver.users["urn:user:bob"].username, stack.services.bob.username);
    assert.equal(driver.users["urn:user:bob"].password, stack.services.bob.password);
    if (name === "web-native") assert.equal(driver.transitionValues["urn:transition:alice-enters-remote-bob"], "custom-bob@http://192.0.2.40:19084");
    if (name === "android") assert.deepEqual(driver.entries["nextcloud.android.files"], {
      kind: "deep-link", route: "https://192.0.2.40:19084/app/openFiles"
    });
  }
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
  const loaded = await loadSuiteConfig(config.pathname, {});
  const androidRuntime = loaded.config.services.android?.options as Record<string, unknown> | undefined;
  assert.ok(androidRuntime);
  assert.equal(androidRuntime?.api, 35);
  assert.equal(androidRuntime?.profile, "pixel_6");
  assert.ok(Array.isArray(androidRuntime?.requiredPackages));
  const androidAdapterOptions = loaded.config.adapters.android?.options as Record<string, unknown> | undefined;
  assert.ok(androidAdapterOptions?.application);
  assert.equal((androidAdapterOptions?.application as Record<string, unknown>).package, "com.nextcloud.client");
  assert.equal(androidAdapterOptions?.runtimeManifest, undefined);
});

test("every journey a mesh runs is drawn on the report's journey map from its JSON-LD source", async () => {
  const { dirname, resolve } = await import("node:path");
  const { loadUjgDocument, toJourneyMapDocument } = await import("@openuji/journey-model-ujg");
  for (const mesh of ["mesh.yaml"]) {
    const path = new URL(mesh, example).pathname;
    for (const item of (await loadSuiteConfig(path, {})).config.tests.flatMap((test) => test.journeys)) {
      const map = toJourneyMapDocument(await loadUjgDocument(resolve(dirname(path), item.source)));
      // The renderer starts root journeys from the entry index: the selected journey must be one of them.
      const root = Object.values(map.states).find((state) => "subjourney" in state && state.subjourney.id === item.select);
      assert.ok(root && "subjourney" in root, `${mesh}: ${item.id} is not a root journey`);
      assert.ok((map.journeyEntryIndex?.entryRefs as string[] | undefined)?.includes(root.subjourney.defaultEntryRef ?? ""), `${mesh}: ${item.id} has no indexed entry`);
    }
  }
});


test("all bundled RC4 documents compile their phased journeys without requiring execution support", async () => {
  const { loadUjgDocumentGraph } = await import("@openuji/journey-model-ujg");
  for (const file of ["filesharing.ujg.jsonld", "filesharing.android.ujg.jsonld", "setup.web.ujg.jsonld", "setup.android.ujg.jsonld", "comparison/nc34.ujg.jsonld"]) {
    const source = new URL(`ujg/${file}`, example);
    const graph = await loadUjgDocumentGraph(source);
    const plan = await compileUjgJourneyPlan(graph);
    assert.ok(plan.operations.length, file);
    assert.equal(plan.source?.references?.specVersion, "1.0-rc4");
  }
});
