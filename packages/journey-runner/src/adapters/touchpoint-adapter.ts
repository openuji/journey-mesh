import type { JourneyAdapter } from "./contracts.js";
import { routedAdapter } from "./routed-adapter.js";

export type JourneyTouchpointAdapters = Readonly<Record<string, JourneyAdapter>>;

/** Compose adapters by exact touchpoint id without coupling the runner to a runtime. */
export function touchpointAdapter(adapters: JourneyTouchpointAdapters): JourneyAdapter {
  const routes = new Map(Object.entries(adapters));
  if (routes.size === 0) throw new Error("touchpointAdapter requires at least one touchpoint adapter");
  return {
    ...routedAdapter((operation) => {
      const adapter = routes.get(operation.touchpointId);
      if (!adapter) throw new Error(`No adapter for touchpoint ${operation.touchpointId} (operation ${operation.id})`);
      return adapter;
    }),
    name: "@openuji/journey-runner/touchpoint-adapter"
  };
}
