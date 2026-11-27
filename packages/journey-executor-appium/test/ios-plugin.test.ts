import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileEvidenceStore } from "@openuji/journey-run-record/node";
import { type JourneyPluginContext } from "@openuji/journey-plugin";
import { iosAppContract } from "@openuji/journey-platform-ios";
import { bundleSha256 } from "@openuji/journey-toolkit-ios";
import { journeyMeshPlugin } from "../src/ios-plugin.js";

async function createFakeAppBundle(directory: string, name = "Nextcloud.app", bundleId = "it.twsweb.Nextcloud"): Promise<{ path: string; sha256: string }> {
  const appPath = join(directory, name);
  await mkdir(appPath, { recursive: true });
  await writeFile(
    join(appPath, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleShortVersionString</key>
  <string>7.3.0</string>
</dict>
</plist>
`
  );
  await writeFile(join(appPath, "Nextcloud"), "mach-o-simulator-binary");
  const sha256 = await bundleSha256(appPath);
  return { path: appPath, sha256 };
}

async function context(directory: string): Promise<JourneyPluginContext> {
  return {
    artifacts: fileEvidenceStore(directory),
    observations: { async publish() {} },
    configPath: join(directory, "mesh.yaml"),
    testId: "test",
    componentId: "executor",
    operations: [],
    env: {},
    resolveOperation() {
      throw new Error("No operations");
    },
    resolvePath: (value) => join(directory, value)
  };
}

test("local .app bundle checksum is verified when execution starts, not during parse", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-executor-appium-ios-plugin-"));
  const iosDir = join(directory, ".ios");
  const bundle = await createFakeAppBundle(iosDir, "Nextcloud.app");
  const client = Object.freeze({
    name: "client",
    resolveEntry: () => Object.freeze({ kind: "application" as const }),
    resolveTransitionValue: () => undefined
  });
  const ctx = await context(directory);
  const options = {
    appDirectory: "./.ios",
    application: { app: "Nextcloud.app", sha256: bundle.sha256, bundleId: "it.twsweb.Nextcloud" },
    devices: { touchpoint: { udid: "SIM-UDID-1" } }
  };
  const settings = await journeyMeshPlugin.parse(options, ctx);
  const executor = await journeyMeshPlugin.create(settings, ctx, { client, observers: [], inputs: {} });
  assert.equal(executor.name, "@openuji/journey-executor-appium/ios");
  const execution = executor.createSession({
    context: { runId: "run", executionId: "execution", plan: { id: "plan", operations: [] }, profile: { id: "profile" } }
  });
  await execution.start();
  await execution.close({ executionFailed: false });

  const mismatchSettings = await journeyMeshPlugin.parse(
    { ...options, application: { ...options.application, sha256: "0".repeat(64) } },
    ctx
  );
  const mismatchExecutor = await journeyMeshPlugin.create(mismatchSettings, ctx, { client, observers: [], inputs: {} });
  const mismatchExecution = mismatchExecutor.createSession({
    context: { runId: "run", executionId: "mismatch", plan: { id: "plan", operations: [] }, profile: { id: "profile" } }
  });
  await assert.rejects(async () => {
    await mismatchExecution.start();
  }, /checksum does not match/);
});

test("service inputs replace the local .app bundle, endpoint and UDIDs, and resolve during construction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-executor-appium-ios-plugin-"));
  const client = Object.freeze({
    name: "client",
    resolveEntry: () => Object.freeze({ kind: "application" as const }),
    resolveTransitionValue: () => undefined
  });
  const options = {
    application: { bundleId: "it.twsweb.Nextcloud" },
    devices: { "urn:touchpoint:alice": { device: "alice" }, "urn:touchpoint:bob": { device: "bob" } }
  };
  const builtBundle = await createFakeAppBundle(directory, "Built.app");
  const app = {
    path: builtBundle.path,
    sha256: builtBundle.sha256,
    bundleId: "it.twsweb.Nextcloud",
    bundleVersion: "1",
    bundleShortVersionString: "7.3.0"
  };
  const values = {
    application: app,
    server: { url: "http://127.0.0.1:4799/" },
    devices: {
      alice: { udid: "SIM-1", simulator: "alice-sim", runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-2", deviceType: "iPhone 17" },
      bob: { udid: "SIM-2", simulator: "bob-sim", runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-2", deviceType: "iPhone 17" }
    }
  };
  const execute = async (inputs: Record<string, unknown>) => {
    const ctx = await context(directory);
    const executor = await journeyMeshPlugin.create(
      await journeyMeshPlugin.parse(options, ctx, { names: Object.keys(inputs) }),
      ctx,
      { client, observers: [], inputs }
    );
    const execution = executor.createSession({
      context: { runId: "run", executionId: "execution", plan: { id: "plan", operations: [] }, profile: { id: "profile" } }
    });
    await execution.start();
    await execution.close({ executionFailed: false });
  };
  await execute(values);
  await assert.rejects(execute({ ...values, application: { ...app, bundleId: "com.other" } }), /application input is com\.other/);
  await assert.rejects(execute({ ...values, devices: { alice: values.devices.alice } }), /no device bob/);
  assert.equal(journeyMeshPlugin.optionalInputs?.application?.id, iosAppContract.id);
});

test("pinned options conflict with the inputs that replace them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-executor-appium-ios-plugin-"));
  const inputs = ["application", "server"];
  const base = { application: { bundleId: "it.twsweb.Nextcloud" }, devices: { t: { udid: "SIM-1" } } };
  const parse = async (options: Record<string, unknown>, given = inputs) =>
    journeyMeshPlugin.parse(options, await context(directory), { names: given });
  await assert.rejects(parse({ ...base, application: { ...base.application, app: "Nextcloud.app" } }), /application\.app conflicts/);
  await assert.rejects(parse({ ...base, application: { ...base.application, sha256: "a".repeat(64) } }), /application\.sha256 conflicts/);
  await assert.rejects(parse({ ...base, endpoint: "http://127.0.0.1:4725/" }), /endpoint conflicts/);
  await assert.rejects(parse({ ...base, devices: { t: { device: "alice" } } }), /requires the devices input/);
  await assert.rejects(parse({ ...base, devices: { t: { udid: "x", device: "alice" } } }), /exactly one of udid or device/);
});

test("the executor plugin rejects an application config missing required fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-executor-appium-ios-plugin-"));
  const options = { application: { app: "Nextcloud.app" }, appDirectory: "./.ios", devices: {} };
  const ctx = await context(directory);
  await assert.rejects(async () => {
    await journeyMeshPlugin.parse(options, ctx);
  }, /application\.bundleId/);
});
