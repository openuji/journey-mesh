import assert from "node:assert/strict";
import test from "node:test";
import { parseAndroidPool } from "@openuji/journey-toolkit-android";

const pins = {
  api: 35, image: "system-images;android-35;google_apis;x86_64",
  localImages: { "darwin-arm64": "system-images;android-35;google_apis;arm64-v8a" }, profile: "pixel_6"
};

test("partial pool startup releases only acquired devices in reverse order", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { androidPoolService } = await import("../src/emulator/plugin.js");
  const root = await mkdtemp(join(tmpdir(), "android-pool-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const attempted: string[] = [], released: string[] = [];
  const pool = parseAndroidPool({ ...pins, devices: { alice: { avd: "alice" }, bob: { avd: "bob" }, carol: { avd: "carol" } } });
  const service = androidPoolService(root, pool, { configPath: join(root, "mesh.yaml"), componentId: "devices" } as never, {
    up: async ({ target }) => { attempted.push(target.avd); if (target.avd === "bob") throw new Error("boot failure"); return { serial: "emulator-5554", avd: target.avd, sdk: "/sdk", image: target.image, reversePorts: [] }; },
    release: async (device) => { released.push(device.avd); }
  });
  await assert.rejects(service.start({}), /boot failure/);
  assert.deepEqual(attempted, ["alice", "bob"]);
  assert.deepEqual(released, ["alice"]);
});

test("a pool lease restores prior ownership and environment without stopping borrowed devices", async (t) => {
  const { mkdtemp, rm, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ownershipPath, writeJsonRecord, readJsonRecord } = await import("@openuji/journey-plugin/node");
  const { androidPoolService } = await import("../src/emulator/plugin.js");
  const root = await mkdtemp(join(tmpdir(), "android-pool-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = { configPath: join(root, "mesh.yaml"), componentId: "devices" } as never;
  const path = ownershipPath(join(root, "mesh.yaml"), "devices");
  const prior = { token: "previous", devices: [{ avd: "older-owner" }] };
  await writeJsonRecord(path, prior);
  const releases: string[] = [];
  const lease = await androidPoolService(root, parseAndroidPool({ ...pins, avd: "borrowed" }), context, {
    up: async ({ target }) => ({ serial: "emulator-5554", avd: target.avd, sdk: "/sdk", image: target.image, reversePorts: [] }),
    release: async (device) => { releases.push(device.avd); assert.equal(device.pid, undefined); }
  }).start({});
  assert.match(await readFile(join(root, ".runtime/android.env"), "utf8"), /emulator-5554/);
  await lease.release(); await lease.release();
  assert.deepEqual(releases, ["borrowed"]);
  assert.deepEqual(await readJsonRecord(path), prior);
  await assert.rejects(readFile(join(root, ".runtime/android.env")), /ENOENT/);
});

test("repeated manual acquisition retains the original environment publication history", async (t) => {
  const { mkdtemp, mkdir, rm, readFile, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ownershipPath, readJsonRecord } = await import("@openuji/journey-plugin/node");
  const { androidPoolService } = await import("../src/emulator/plugin.js");
  const root = await mkdtemp(join(tmpdir(), "android-up-twice-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".runtime"));
  const original = "ANDROID_UDID=previous-device\n";
  await writeFile(join(root, ".runtime/android.env"), original);
  const context = { configPath: join(root, "mesh.yaml"), componentId: "devices" } as never;
  const service = androidPoolService(root, parseAndroidPool({ ...pins, avd: "managed" }), context, {
    up: async ({ target }) => ({ serial: "emulator-5556", avd: target.avd, sdk: "/sdk", image: target.image, reversePorts: [] }), release: async () => {}
  });
  const first = await service.start({}), second = await service.start({});
  const record = await readJsonRecord<{ publication: { previous: string } }>(ownershipPath(join(root, "mesh.yaml"), "devices"));
  assert.equal(record?.publication.previous, original, "explicit down can restore the value from before both up calls");
  await second.release(); await first.release();
  assert.equal(await readFile(join(root, ".runtime/android.env"), "utf8"), original);
});
