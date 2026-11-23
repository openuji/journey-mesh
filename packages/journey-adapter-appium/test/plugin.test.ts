import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileEvidenceStore } from "@openuji/journey-run-record/node";
import { type JourneyPluginContext } from "@openuji/journey-plugin";
import { androidApkContract } from "@openuji/journey-driver-android";
import { journeyMeshPlugin } from "../src/plugin.js";

async function serveApk(data: Buffer): Promise<{ url: string; sha256: string; close: () => Promise<void> }> {
  const sha256 = createHash("sha256").update(data).digest("hex");
  const server: Server = createServer((_request, response) => { response.writeHead(200); response.end(data); });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}/app.apk`, sha256, close: () => new Promise<void>((done) => server.close(() => done())) };
}

async function context(directory: string): Promise<JourneyPluginContext> {
  return {
    artifacts: fileEvidenceStore(directory), observations: { async publish() {} }, configPath: join(directory, "mesh.yaml"), testId: "test", componentId: "adapter",
    operations: [], env: {}, resolveOperation() { throw new Error("No operations"); }, resolvePath: (value) => join(directory, value)
  };
}

test("validation never downloads; the pinned APK is downloaded once, when the first execution starts", async () => {
  const data = Buffer.from("fake apk bytes");
  const server = await serveApk(data);
  const directory = await mkdtemp(join(tmpdir(), "journey-adapter-appium-plugin-"));
  const options = {
    apkDirectory: "./.android",
    application: { apk: "app.apk", url: server.url, sha256: server.sha256, package: "com.example.app", activity: "MainActivity" },
    devices: { touchpoint: { udid: "emulator-5554" } }
  };
  try {
    const ctx = await context(directory);
    const settings = await journeyMeshPlugin.parse(options, ctx);
    const driver = Object.freeze({ name: "driver", resolveEntry: () => Object.freeze({ kind: "application" as const }), resolveTransitionValue: () => undefined });
    const adapter = await journeyMeshPlugin.create(settings, ctx, { driver, observers: [], inputs: {} });
    assert.equal(adapter.name, "@openuji/journey-adapter-appium");
    await assert.rejects(readFile(join(directory, ".android/app.apk")), /ENOENT/);
    const execution = adapter.createExecution({ context: { runId: "run", executionId: "execution", plan: { id: "plan", operations: [] }, profile: { id: "profile" } } });
    await execution.start();
    await execution.close({ executionFailed: false });
    assert.deepEqual(await readFile(join(directory, ".android/app.apk")), data);
  } finally { await server.close(); }
});

test("service inputs replace the pinned APK, endpoint and UDIDs, and resolve during construction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-adapter-appium-plugin-"));
  const driver = Object.freeze({ name: "driver", resolveEntry: () => Object.freeze({ kind: "application" as const }), resolveTransitionValue: () => undefined });
  const options = {
    application: { package: "com.example.app", activity: "MainActivity" },
    devices: { "urn:touchpoint:alice": { device: "alice" }, "urn:touchpoint:bob": { device: "bob" } }
  };
  const apk = { path: join(directory, "built.apk"), sha256: createHash("sha256").update("built").digest("hex"), package: "com.example.app", versionCode: 1, versionName: "1.0" };
  await writeFile(apk.path, "built");
  const values = {
    application: apk, server: { url: "http://127.0.0.1:4799/" },
    devices: { alice: { udid: "emulator-5554", avd: "a", api: 35 }, bob: { udid: "emulator-5556", avd: "b", api: 35 } }
  };
  const execute = async (inputs: Record<string, unknown>) => {
    const ctx = await context(directory);
    const adapter = await journeyMeshPlugin.create(await journeyMeshPlugin.parse(options, ctx, { names: Object.keys(inputs) }), ctx, { driver, observers: [], inputs });
    const execution = adapter.createExecution({ context: { runId: "run", executionId: "execution", plan: { id: "plan", operations: [] }, profile: { id: "profile" } } });
    await execution.start();
    await execution.close({ executionFailed: false });
  };
  await execute(values);
  await assert.rejects(execute({ ...values, application: { ...apk, package: "com.other" } }), /application input is com\.other/);
  await assert.rejects(execute({ ...values, devices: { alice: values.devices.alice } }), /no device bob/);
  assert.equal(journeyMeshPlugin.optionalInputs?.application?.id, androidApkContract.id);
});

test("pinned options conflict with the inputs that replace them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-adapter-appium-plugin-"));
  const inputs = ["application", "server"];
  const base = { application: { package: "p", activity: "a" }, devices: { t: { udid: "emulator-5554" } } };
  const parse = async (options: Record<string, unknown>, given = inputs) => journeyMeshPlugin.parse(options, await context(directory), { names: given });
  await assert.rejects(parse({ ...base, application: { ...base.application, url: "https://example.test/app.apk" } }), /application\.url conflicts/);
  await assert.rejects(parse({ ...base, endpoint: "http://127.0.0.1:4723/" }), /endpoint conflicts/);
  await assert.rejects(parse({ ...base, devices: { t: { device: "alice" } } }), /requires the devices input/);
  await assert.rejects(parse({ ...base, devices: { t: { udid: "x", device: "alice" } } }), /exactly one of udid or device/);
});

test("the adapter plugin rejects an application config missing required fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-adapter-appium-plugin-"));
  const options = { application: { apk: "app.apk" }, apkDirectory: "./.android", devices: {} };
  const ctx = await context(directory);
  await assert.rejects(async () => { await journeyMeshPlugin.parse(options, ctx); }, /application\.(url|sha256|package|activity)/);
});
