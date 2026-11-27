import assert from "node:assert/strict";
import test from "node:test";
import { parseIosPool } from "@openuji/journey-toolkit-ios";

const pins = { deviceType: "iPhone 17", runtime: "26.2" };

test("partial simulator pool startup releases only acquired simulators in reverse order", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { iosPoolService } = await import("../src/simulator/plugin.js");
  const root = await mkdtemp(join(tmpdir(), "ios-pool-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const attempted: string[] = [], released: string[] = [];
  const pool = parseIosPool({ ...pins, devices: { alice: { simulator: "alice" }, bob: { simulator: "bob" }, carol: { simulator: "carol" } } });
  const service = iosPoolService(root, pool, { configPath: join(root, "mesh.yaml"), componentId: "devices" } as never, {
    up: async ({ target }) => {
      attempted.push(target.simulator);
      if (target.simulator === "bob") throw new Error("boot failure");
      return { udid: "UDID-1", simulator: target.simulator, deviceType: target.deviceType, runtime: target.runtime, platformVersion: "26.2", owned: true };
    },
    release: async (device) => { released.push(device.simulator); }
  });
  await assert.rejects(service.start({}), /boot failure/);
  assert.deepEqual(attempted, ["alice", "bob"]);
  assert.deepEqual(released, ["alice"]);
});

test("a simulator pool lease restores prior ownership and environment without stopping borrowed simulators", async (t) => {
  const { mkdtemp, rm, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ownershipPath, writeJsonRecord, readJsonRecord } = await import("@openuji/journey-plugin/node");
  const { iosPoolService } = await import("../src/simulator/plugin.js");
  const root = await mkdtemp(join(tmpdir(), "ios-pool-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = { configPath: join(root, "mesh.yaml"), componentId: "devices" } as never;
  const path = ownershipPath(join(root, "mesh.yaml"), "devices");
  const prior = { token: "previous", devices: [{ simulator: "older-owner" }] };
  await writeJsonRecord(path, prior);
  const releases: string[] = [];
  const lease = await iosPoolService(root, parseIosPool({ ...pins, simulator: "borrowed" }), context, {
    up: async ({ target }) => ({ udid: "SIM-UDID-1", simulator: target.simulator, deviceType: target.deviceType, runtime: target.runtime, platformVersion: "26.2", owned: false }),
    release: async (device) => { releases.push(device.simulator); assert.equal(device.owned, false); }
  }).start({});
  assert.match(await readFile(join(root, ".runtime/ios.env"), "utf8"), /SIM-UDID-1/);
  await lease.release(); await lease.release();
  assert.deepEqual(releases, ["borrowed"]);
  assert.deepEqual(await readJsonRecord(path), prior);
  await assert.rejects(readFile(join(root, ".runtime/ios.env")), /ENOENT/);
});

test("repeated manual acquisition retains the original environment publication history", async (t) => {
  const { mkdtemp, mkdir, rm, readFile, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ownershipPath, readJsonRecord } = await import("@openuji/journey-plugin/node");
  const { iosPoolService } = await import("../src/simulator/plugin.js");
  const root = await mkdtemp(join(tmpdir(), "ios-up-twice-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".runtime"));
  const original = "IOS_UDID=previous-simulator\n";
  await writeFile(join(root, ".runtime/ios.env"), original);
  const context = { configPath: join(root, "mesh.yaml"), componentId: "devices" } as never;
  const service = iosPoolService(root, parseIosPool({ ...pins, simulator: "managed" }), context, {
    up: async ({ target }) => ({ udid: "SIM-UDID-2", simulator: target.simulator, deviceType: target.deviceType, runtime: target.runtime, platformVersion: "26.2", owned: true }),
    release: async () => {}
  });
  const first = await service.start({}), second = await service.start({});
  const record = await readJsonRecord<{ publication: { previous: string } }>(ownershipPath(join(root, "mesh.yaml"), "devices"));
  assert.equal(record?.publication.previous, original);
  await second.release(); await first.release();
  assert.equal(await readFile(join(root, ".runtime/ios.env"), "utf8"), original);
});
