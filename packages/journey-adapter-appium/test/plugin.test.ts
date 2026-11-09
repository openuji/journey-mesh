import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileArtifactStore, type JourneyPluginContext } from "@openuji/journey-runtime";
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
    artifacts: fileArtifactStore(directory), configPath: join(directory, "mesh.yaml"), testId: "test",
    operations: [], env: {}, resolvePath: (value) => join(directory, value)
  };
}

test("the adapter plugin ensures its APK is downloaded from inline application options, no manifest file", async () => {
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
    await journeyMeshPlugin.validate(options, ctx);
    const driver = Object.freeze({ name: "driver", resolveEntry: () => Object.freeze({ kind: "application" as const }), resolveTransitionValue: () => undefined });
    const adapter = await journeyMeshPlugin.create(options, ctx, { driver });
    assert.equal(adapter.name, "@openuji/journey-adapter-appium");
    assert.deepEqual(await readFile(join(directory, ".android/app.apk")), data);
  } finally { await server.close(); }
});

test("the adapter plugin rejects an application config missing required fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "journey-adapter-appium-plugin-"));
  const options = { application: { apk: "app.apk" }, apkDirectory: "./.android", devices: {} };
  const ctx = await context(directory);
  await assert.rejects(async () => { await journeyMeshPlugin.validate(options, ctx); }, /application\.(url|sha256|package|activity)/);
});
