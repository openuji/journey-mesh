import { serviceLifecycle, type RuntimeObserver } from "@openuji/journey-plugin";

export type ProgressObservationOptions = Readonly<{
  /** How often a service that is still starting or releasing is reported again. */
  heartbeatMs: number;
}>;

const duration = (milliseconds: number): string => {
  const seconds = Math.round(milliseconds / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
};

/** Prints what every service of a run is doing, so a slow or hung one is visible while it happens. */
export function createProgressRuntimeObserver(options: ProgressObservationOptions, log: (line: string) => void = console.log): RuntimeObserver {
  const underWay = new Map<string, Readonly<{ since: number; heartbeat: ReturnType<typeof setInterval> }>>();
  const finish = (service: string) => {
    const item = underWay.get(service);
    if (item) clearInterval(item.heartbeat);
    underWay.delete(service);
    return item;
  };
  let unsubscribe: (() => void) | undefined;
  return {
    start(source) {
      unsubscribe = source.subscribe(serviceLifecycle, ({ source: service, value: { phase } }) => {
        const previous = finish(service);
        if (phase === "starting" || phase === "releasing") {
          const since = Date.now();
          log(`[${service}] ${phase}`);
          const heartbeat = setInterval(() => log(`[${service}] still ${phase} after ${duration(Date.now() - since)}`), options.heartbeatMs);
          heartbeat.unref?.();
          underWay.set(service, { since, heartbeat });
        } else log(`[${service}] ${phase}${previous ? ` after ${duration(Date.now() - previous.since)}` : ""}`);
      }, { name: "progress-runtime-observer" });
    },
    close() {
      unsubscribe?.(); unsubscribe = undefined;
      for (const service of [...underWay.keys()]) finish(service);
    }
  };
}
