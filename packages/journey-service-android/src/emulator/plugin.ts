import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { defineServicePlugin, startedService, type JourneyPluginContext, type JourneyService } from "@openuji/journey-plugin";
import { ownershipPath, readJsonRecord, writeJsonRecord, removeOwnership, publishText, releaseText, type TextPublication } from "@openuji/journey-plugin/node";
import { androidDevicesContract, type AndroidDevice } from "@openuji/journey-platform-android";
import { androidUp, parseAndroidPool, releaseAndroidDevice, type AndroidAcquisition, type AndroidPool } from "@openuji/journey-toolkit-android";

type PoolOwnership = Readonly<{ token: string; devices: readonly AndroidAcquisition[]; publication?: TextPublication }>;
async function releasePool(pool: PoolOwnership, release = releaseAndroidDevice): Promise<void> {
  const failures: unknown[] = [];
  for (const device of [...pool.devices].reverse()) try { await release(device); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "Stopping acquired Android devices failed");
}
async function stopPool(context: JourneyPluginContext): Promise<void> {
  const path = ownershipPath(context.configPath, context.componentId);
  const pool = await readJsonRecord<PoolOwnership>(path);
  if (!pool) return;
  await releasePool(pool);
  if (pool.publication) await releaseText(pool.publication);
  await removeOwnership(path);
}
export const journeyMeshPlugin = defineServicePlugin({
  kind: "service", outputs: { devices: androidDevicesContract },
  parse(options, context) { return { root: dirname(context.configPath), pool: parseAndroidPool(options) }; },
  create({ root, pool }, context) { return androidPoolService(root, pool, context); },
  stopConfigured: stopPool
});

export function androidPoolService(root: string, pool: AndroidPool, context: JourneyPluginContext, ports: { up?: typeof androidUp; release?: typeof releaseAndroidDevice } = {}): JourneyService {
  const up = ports.up ?? androidUp;
  const release = ports.release ?? releaseAndroidDevice;
  return Object.freeze({
    name: "android",
    async start({ signal }) {
      const path = ownershipPath(context.configPath, context.componentId);
      const previous = await readJsonRecord<PoolOwnership>(path);
      let publication: TextPublication | undefined;
      let acquired: readonly AndroidAcquisition[] = Object.freeze([]);
      let devices: Readonly<Record<string, AndroidDevice>> = Object.freeze({});
      try {
        for (const [name, target] of Object.entries(pool.targets)) {
          signal?.throwIfAborted();
          const device = await up({ root, target, signal });
          acquired = [...acquired, device];
          devices = Object.freeze({ ...devices, [name]: Object.freeze({ udid: device.serial, avd: target.avd, api: target.api }) });
        }
        const environmentPath = pool.environmentFile ? resolve(root, ".runtime/android.env") : undefined;
        if (environmentPath) publication = await publishText(environmentPath, `ANDROID_UDID=${Object.values(devices)[0]!.udid}\n`);
        const lease = Object.freeze({ token: randomUUID(), devices: acquired, ...(publication ? { publication } : {}) });
        // Manual up may reacquire a service already left running by an earlier up.
        // Keep its original publication history; this run's lease still restores its immediate predecessor.
        const persistedPublication = publication && previous?.publication?.path === publication.path
          ? { path: publication.path, content: publication.content, ...(previous.publication.previous === undefined ? {} : { previous: previous.publication.previous }) }
          : publication;
        await writeJsonRecord(path, { ...lease, ...(persistedPublication ? { publication: persistedPublication } : {}), devices: [...(previous?.devices ?? []), ...acquired] });
        return startedService({ devices }, Object.fromEntries(Object.entries(pool.targets).map(([name, target]) => [name, { avd: target.avd, api: target.api, profile: target.profile }])), async () => {
          if ((await readJsonRecord<PoolOwnership>(path))?.token !== lease.token) return;
          await releasePool(lease, release);
          if (publication) await releaseText(publication);
          if (previous) await writeJsonRecord(path, previous); else await removeOwnership(path);
        });
      } catch (error) {
        try { await releasePool({ token: "partial", devices: acquired }, release); if (publication) await releaseText(publication); } catch (cleanup) { throw new AggregateError([error, cleanup], "Android pool startup and cleanup failed"); }
        throw error;
      }
    }
  });
}
