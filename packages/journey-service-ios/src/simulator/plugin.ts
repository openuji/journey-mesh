import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { defineServicePlugin, startedService, type JourneyPluginContext, type JourneyService } from "@openuji/journey-plugin";
import { ownershipPath, readJsonRecord, writeJsonRecord, removeOwnership, publishText, releaseText, type TextPublication } from "@openuji/journey-plugin/node";
import { iosDevicesContract, type IosDevice } from "@openuji/journey-platform-ios";
import { iosUp, parseIosPool, releaseIosDevice, type IosAcquisition, type IosPool } from "@openuji/journey-toolkit-ios";

type PoolOwnership = Readonly<{ token: string; devices: readonly IosAcquisition[]; publication?: TextPublication }>;

async function releasePool(pool: PoolOwnership, release = releaseIosDevice): Promise<void> {
  const failures: unknown[] = [];
  for (const device of [...pool.devices].reverse()) try { await release(device); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "Stopping acquired iOS simulators failed");
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
  kind: "service",
  outputs: { devices: iosDevicesContract },
  parse(options, context) { return { root: dirname(context.configPath), pool: parseIosPool(options) }; },
  create({ root, pool }, context) { return iosPoolService(root, pool, context); },
  stopConfigured: stopPool
});

export function iosPoolService(
  root: string,
  pool: IosPool,
  context: JourneyPluginContext,
  ports: { up?: typeof iosUp; release?: typeof releaseIosDevice } = {}
): JourneyService {
  const up = ports.up ?? iosUp;
  const release = ports.release ?? releaseIosDevice;
  return Object.freeze({
    name: "ios",
    async start({ signal }) {
      const path = ownershipPath(context.configPath, context.componentId);
      const previous = await readJsonRecord<PoolOwnership>(path);
      let publication: TextPublication | undefined;
      let acquired: readonly IosAcquisition[] = Object.freeze([]);
      let devices: Readonly<Record<string, IosDevice>> = Object.freeze({});
      try {
        for (const [name, target] of Object.entries(pool.targets)) {
          signal?.throwIfAborted();
          const device = await up({ root, target, signal });
          acquired = [...acquired, device];
          devices = Object.freeze({
            ...devices,
            [name]: Object.freeze({
              udid: device.udid,
              simulator: device.simulator,
              deviceType: device.deviceType,
              runtime: device.runtime,
              platformVersion: device.platformVersion
            })
          });
        }
        const environmentPath = pool.environmentFile ? resolve(root, ".runtime/ios.env") : undefined;
        if (environmentPath) publication = await publishText(environmentPath, `IOS_UDID=${Object.values(devices)[0]!.udid}\n`);
        const lease = Object.freeze({ token: randomUUID(), devices: acquired, ...(publication ? { publication } : {}) });
        const persistedPublication = publication && previous?.publication?.path === publication.path
          ? { path: publication.path, content: publication.content, ...(previous.publication.previous === undefined ? {} : { previous: previous.publication.previous }) }
          : publication;
        await writeJsonRecord(path, {
          ...lease,
          ...(persistedPublication ? { publication: persistedPublication } : {}),
          devices: [...(previous?.devices ?? []), ...acquired]
        });
        const provenance = Object.fromEntries(Object.entries(pool.targets).map(([name, target]) => [
          name,
          { simulator: target.simulator, deviceType: target.deviceType, runtime: target.runtime }
        ]));
        return startedService({ devices }, provenance, async () => {
          if ((await readJsonRecord<PoolOwnership>(path))?.token !== lease.token) return;
          await releasePool(lease, release);
          if (publication) await releaseText(publication);
          if (previous) await writeJsonRecord(path, previous); else await removeOwnership(path);
        });
      } catch (error) {
        try {
          await releasePool({ token: "partial", devices: acquired }, release);
          if (publication) await releaseText(publication);
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], "iOS simulator pool startup and cleanup failed");
        }
        throw error;
      }
    }
  });
}
