import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { compileUjgJourneyPlan } from "@openuji/journey-model-ujg";
import { interpolate, loadSuiteConfig, validateSuite } from "@openuji/journey-host";

const example = new URL("../", import.meta.url);

test("example delegates Nextcloud mechanics and retains only scenario configuration", async () => {
  const config = await readFile(new URL("mesh.yaml", example), "utf8");
  assert.match(config, /@openuji\/journey-vendor-nextcloud\/federated-sharing\/plugin/);
  assert.match(config, /shareCreated: urn:effect:alice-confirm-share/);
  assert.match(config, /shareAccepted: urn:effect:bob-accept-share/);
  assert.ok(!(await readdir(example)).includes("environment.ts"));
});

test("example pins its Nextcloud deployment image to a versioned digest", async () => {
  const { config } = await loadSuiteConfig(new URL("mesh.yaml", example).pathname, {});
  const compose = await readFile(new URL("deployment/compose.yaml", example), "utf8");
  const image = "nextcloud:34.0.2-apache@sha256:e93ccfc952c95f18175f3d297fb2f60c35070c05ca976050c250a9ddab793e75";
  for (const key of ["web-stack", "android-stack", "ios-stack"]) {
    assert.equal(config.services[key].use, "@openuji/journey-vendor-nextcloud/stack/service");
    assert.equal(config.services[key].options.image, image);
    assert.equal(config.services[key].options.expectedVersion, "34.0.2");
  }
  assert.equal(compose.split("image: ${NEXTCLOUD_IMAGE:?").length - 1, 2);
  assert.doesNotMatch(compose, /image: nextcloud:/);
});

test("native Android and iOS scenarios enter Files explicitly and model notification navigation", async () => {
  for (const [file, binding] of [
    ["../ujg/filesharing.android.ujg.jsonld", "nextcloud.android.files"],
    ["../ujg/filesharing.ios.ujg.jsonld", "nextcloud.ios.files"]
  ] as const) {
    const plan = await compileUjgJourneyPlan(new URL(file, import.meta.url), {
      journeyId: "urn:journey:bob-remote-share"
    });
    assert.deepEqual(
      [...new Set(plan.operations.flatMap((operation) => (operation.entryBinding ? [operation.entryBinding.value] : [])))],
      [binding]
    );
    assert.ok(plan.operations.some((operation) => operation.source?.references?.graphNodeId === "urn:transition:bob-opens-native-notifications"));
    assert.ok(Object.isFrozen(plan.operations));
  }
});

test("browser selection validates without Android or iOS device or app configuration", async () => {
  const config = new URL("../mesh.yaml", import.meta.url);
  assert.deepEqual((await validateSuite(config.pathname, { test: "browser-sharing", env: {} })).tests, ["browser-sharing"]);
  const loaded = await loadSuiteConfig(config.pathname, {});
  assert.equal(loaded.config.tests.length, 3);
  assert.deepEqual(loaded.config.envFiles.filter((entry) => entry.path?.startsWith("./.runtime/")), [
    { path: "./.runtime/android.env", optional: true },
    { path: "./.runtime/appium.env", optional: true },
    { path: "./.runtime/ios.env", optional: true },
    { path: "./.runtime/appium-ios.env", optional: true }
  ]);
  const legacy = await readdir(example);
  assert.ok(!legacy.includes("android.run.ts"));
  assert.ok(!legacy.includes("playwright.config.ts"));
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["android:local"], undefined);
  assert.match(packageJson.scripts["android:up"], /journey-mesh services up mesh\.yaml --service android/);
  assert.match(packageJson.scripts["appium:up"], /journey-mesh services up mesh\.yaml --service appium/);
  assert.match(packageJson.scripts["ios:up"], /journey-mesh services up mesh\.yaml --service ios/);
  assert.match(packageJson.scripts["appium:ios:up"], /journey-mesh services up mesh\.yaml --service appium-ios/);
});

test("tests select isolated packaged stacks and keep ports and directories disjoint", async () => {
  const { config, env } = await loadSuiteConfig(new URL("mesh.yaml", example).pathname, {
    NEXTCLOUD_ANDROID_STACK_HOST: "192.0.2.40",
    NEXTCLOUD_IOS_STACK_HOST: "192.0.2.50"
  });
  assert.deepEqual(config.tests.map((entry) => entry.services), [["web-stack"], ["android-stack"], ["ios-stack"]]);
  const web = interpolate(config.services["web-stack"].options, env, "web-stack");
  const native = interpolate(config.services["android-stack"].options, env, "android-stack");
  const ios = interpolate(config.services["ios-stack"].options, env, "ios-stack");
  assert.equal(new Set([web.project, native.project, ios.project]).size, 3);
  assert.equal(new Set([web.directory, native.directory, ios.directory]).size, 3);
  const ports = [web.environment, native.environment, ios.environment].flatMap((value) => {
    const environment = value as Record<string, string>;
    return [environment.NEXTCLOUD_ALICE_PORT, environment.NEXTCLOUD_BOB_PORT];
  });
  assert.equal(new Set(ports).size, 6);
  assert.deepEqual(config.envFiles.map((entry) => entry.path), [
    "./deployment/.env.example",
    "./deployment/.env",
    "./.runtime/android.env",
    "./.runtime/appium.env",
    "./.runtime/ios.env",
    "./.runtime/appium-ios.env"
  ]);
});

test("native Android and iOS selections require hosts and share overridden URLs and accounts across components", async () => {
  const path = new URL("mesh.yaml", example).pathname;
  const { config } = await loadSuiteConfig(path, {});
  const stackEnvironment = config.services["android-stack"].options.environment as Record<string, string>;
  assert.throws(() => interpolate(stackEnvironment.NEXTCLOUD_ALICE_HOST, {}, "android-stack"), /NEXTCLOUD_ANDROID_STACK_HOST/);
  await assert.rejects(
    validateSuite(path, { test: "native-recipient-sharing", env: { NEXTCLOUD_ANDROID_STACK_HOST: "", ANDROID_UDID: "emulator-5554" } }),
    /NEXTCLOUD_ANDROID_STACK_HOST/
  );
  const { env } = await loadSuiteConfig(path, {
    NEXTCLOUD_ANDROID_STACK_HOST: "192.0.2.40",
    NEXTCLOUD_ANDROID_ALICE_PORT: "19083",
    NEXTCLOUD_ANDROID_BOB_PORT: "19084",
    NEXTCLOUD_BOB_USER: "custom-bob",
    NEXTCLOUD_BOB_PASSWORD: "custom-password",
    ANDROID_UDID: "emulator-5554"
  });
  assert.deepEqual((await validateSuite(path, { test: "native-recipient-sharing", env: { ...env } })).tests, ["native-recipient-sharing"]);
  const stack = interpolate(config.services["android-stack"].options, env, "android-stack") as {
    environment: Record<string, string>;
    services: Record<string, { baseURL: string; username: string; password: string }>;
  };
  const environment = interpolate(config.tests[1].environment!.options, env, "environment") as {
    sharerTouchpoint: { baseURL: string };
    recipientTouchpoint: { baseURL: string };
    recipientUser: { username: string; password: string };
  };
  assert.equal(stack.environment.NEXTCLOUD_ALICE_URL, "http://192.0.2.40:19083");
  assert.equal(stack.environment.NEXTCLOUD_BOB_URL, "http://192.0.2.40:19084");
  assert.equal(environment.sharerTouchpoint.baseURL, stack.services.alice.baseURL);
  assert.equal(environment.recipientTouchpoint.baseURL, stack.services.bob.baseURL);
  for (const name of ["web-native", "android"]) {
    const client = interpolate(config.executors[name].client!.options, env, name) as {
      touchpoints: Record<string, { baseURL: string }>;
      users: Record<string, { username: string; password: string }>;
      entries: Record<string, unknown>;
      transitionValues: Record<string, unknown>;
    };
    assert.equal(client.touchpoints["urn:touchpoint:nextcloud-a"].baseURL, environment.sharerTouchpoint.baseURL);
    assert.equal(client.touchpoints["urn:touchpoint:nextcloud-b"].baseURL, environment.recipientTouchpoint.baseURL);
    assert.equal(client.users["urn:user:bob"].username, stack.services.bob.username);
    assert.equal(client.users["urn:user:bob"].password, stack.services.bob.password);
    if (name === "web-native") assert.equal(client.transitionValues["urn:transition:alice-enters-remote-bob"], "custom-bob@http://192.0.2.40:19084");
    if (name === "android") {
      assert.deepEqual(client.entries["nextcloud.android.files"], {
        kind: "deep-link",
        route: "https://192.0.2.40:19084/app/openFiles"
      });
    }
  }

  const iosStackEnvironment = config.services["ios-stack"].options.environment as Record<string, string>;
  assert.throws(() => interpolate(iosStackEnvironment.NEXTCLOUD_ALICE_HOST, {}, "ios-stack"), /NEXTCLOUD_IOS_STACK_HOST/);
  await assert.rejects(
    validateSuite(path, { test: "ios-recipient-sharing", env: { NEXTCLOUD_IOS_STACK_HOST: "" } }),
    /NEXTCLOUD_IOS_STACK_HOST/
  );
  const { env: iosEnv } = await loadSuiteConfig(path, {
    NEXTCLOUD_IOS_STACK_HOST: "192.0.2.50",
    NEXTCLOUD_IOS_ALICE_PORT: "19085",
    NEXTCLOUD_IOS_BOB_PORT: "19086",
    NEXTCLOUD_BOB_USER: "custom-bob",
    NEXTCLOUD_BOB_PASSWORD: "custom-password"
  });
  assert.deepEqual((await validateSuite(path, { test: "ios-recipient-sharing", env: { ...iosEnv } })).tests, ["ios-recipient-sharing"]);
  const iosStack = interpolate(config.services["ios-stack"].options, iosEnv, "ios-stack") as {
    environment: Record<string, string>;
    services: Record<string, { baseURL: string; username: string; password: string }>;
  };
  const iosScenarioEnv = interpolate(config.tests[2].environment!.options, iosEnv, "ios-environment") as {
    sharerTouchpoint: { baseURL: string };
    recipientTouchpoint: { baseURL: string };
    recipientUser: { username: string; password: string };
  };
  assert.equal(iosStack.environment.NEXTCLOUD_ALICE_URL, "http://192.0.2.50:19085");
  assert.equal(iosStack.environment.NEXTCLOUD_BOB_URL, "http://192.0.2.50:19086");
  assert.equal(iosScenarioEnv.sharerTouchpoint.baseURL, iosStack.services.alice.baseURL);
  assert.equal(iosScenarioEnv.recipientTouchpoint.baseURL, iosStack.services.bob.baseURL);
  for (const name of ["web-ios", "ios"]) {
    const client = interpolate(config.executors[name].client!.options, iosEnv, name) as {
      touchpoints: Record<string, { baseURL: string }>;
      users: Record<string, { username: string; password: string }>;
      entries: Record<string, unknown>;
      transitionValues: Record<string, unknown>;
    };
    assert.equal(client.touchpoints["urn:touchpoint:nextcloud-a"].baseURL, iosScenarioEnv.sharerTouchpoint.baseURL);
    assert.equal(client.touchpoints["urn:touchpoint:nextcloud-b"].baseURL, iosScenarioEnv.recipientTouchpoint.baseURL);
    assert.equal(client.users["urn:user:bob"].username, iosStack.services.bob.username);
    assert.equal(client.users["urn:user:bob"].password, iosStack.services.bob.password);
    if (name === "web-ios") assert.equal(client.transitionValues["urn:transition:alice-enters-remote-bob"], "custom-bob@http://192.0.2.50:19086");
    if (name === "ios") {
      assert.deepEqual(client.entries["nextcloud.ios.files"], {
        kind: "deep-link",
        route: "nextcloud://openFiles"
      });
    }
  }
});

test("example delegates Android/iOS/Appium infrastructure lifecycle to the owning packages", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  assert.ok(!("appium" in allDependencies));
  assert.ok(!("appium-uiautomator2-client" in allDependencies));
  assert.ok(!("appium-xcuitest-driver" in allDependencies));
  assert.ok(!("playwright" in allDependencies));
  assert.ok("@openuji/journey-service-android" in packageJson.dependencies);
  assert.ok("@openuji/journey-service-ios" in packageJson.dependencies);
  assert.ok("@openuji/journey-service-git" in packageJson.dependencies);
  assert.ok("@openuji/journey-executor-appium" in packageJson.dependencies);
  assert.equal(packageJson.scripts["android:apk"], undefined);
  await assert.rejects(readdir(new URL("android/", example)), /ENOENT/);
  await assert.rejects(readdir(new URL("ios/", example)), /ENOENT/);
});

test("Android and iOS device pins and Nextcloud application configs live in mesh.yaml, not separate manifests", async () => {
  const config = new URL("../mesh.yaml", import.meta.url);
  const loaded = await loadSuiteConfig(config.pathname, {});
  const androidRuntime = loaded.config.services.android?.options as Record<string, unknown> | undefined;
  assert.ok(androidRuntime);
  assert.equal(androidRuntime?.api, 35);
  assert.equal(androidRuntime?.profile, "pixel_6");
  assert.ok(Array.isArray(androidRuntime?.requiredPackages));
  const androidExecutorOptions = loaded.config.executors.android?.options as Record<string, unknown> | undefined;
  assert.ok(androidExecutorOptions?.application);
  assert.equal((androidExecutorOptions?.application as Record<string, unknown>).package, "com.nextcloud.client");
  assert.equal(androidExecutorOptions?.runtimeManifest, undefined);

  const iosRuntime = loaded.config.services.ios?.options as Record<string, unknown> | undefined;
  assert.ok(iosRuntime);
  assert.equal(iosRuntime?.locale, "en-US");
  const iosBuild = loaded.config.services["ios-app"]?.options as Record<string, unknown> | undefined;
  assert.equal(iosBuild?.scheme, "Nextcloud");
  assert.equal(iosBuild?.output, "Build/Products/Debug-iphonesimulator/Nextcloud.app");
  const iosExecutorOptions = loaded.config.executors.ios?.options as Record<string, unknown> | undefined;
  assert.equal((iosExecutorOptions?.application as Record<string, unknown>).bundleId, "it.twsweb.Nextcloud");
  assert.deepEqual(loaded.config.executors.ios?.inputs, {
    application: { service: "ios-app", output: "app" },
    server: { service: "appium-ios", output: "server" },
    devices: { service: "ios", output: "devices" }
  });
});

test("every journey a mesh runs is drawn on the report's journey map from its JSON-LD source", async () => {
  const { dirname, resolve } = await import("node:path");
  const { loadUjgDocument, toJourneyMapDocument } = await import("@openuji/journey-model-ujg");
  for (const mesh of ["mesh.yaml"]) {
    const path = new URL(mesh, example).pathname;
    for (const item of (await loadSuiteConfig(path, {})).config.tests.flatMap((test) => test.journeys)) {
      const map = toJourneyMapDocument(await loadUjgDocument(resolve(dirname(path), item.source)));
      const root = Object.values(map.states).find((state) => "subjourney" in state && state.subjourney.id === item.select);
      assert.ok(root && "subjourney" in root, `${mesh}: ${item.id} is not a root journey`);
      assert.ok((map.journeyEntryIndex?.entryRefs as string[] | undefined)?.includes(root.subjourney.defaultEntryRef ?? ""), `${mesh}: ${item.id} has no indexed entry`);
    }
  }
});

test("all bundled RC4 documents compile their phased journeys without requiring execution support", async () => {
  const { loadUjgDocumentGraph } = await import("@openuji/journey-model-ujg");
  for (const file of [
    "filesharing.ujg.jsonld",
    "filesharing.android.ujg.jsonld",
    "filesharing.ios.ujg.jsonld",
    "setup.web.ujg.jsonld",
    "setup.android.ujg.jsonld",
    "setup.ios.ujg.jsonld",
    "comparison/nc34.ujg.jsonld"
  ]) {
    const source = new URL(`ujg/${file}`, example);
    const graph = await loadUjgDocumentGraph(source);
    const plan = await compileUjgJourneyPlan(graph);
    assert.ok(plan.operations.length, file);
    assert.equal(plan.source?.references?.specVersion, "1.0-rc4");
  }
});
