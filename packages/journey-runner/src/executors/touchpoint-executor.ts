import type { JourneyExecutor } from "./contracts.js";
import { routedExecutor } from "./routed-executor.js";

export type JourneyTouchpointExecutors = Readonly<Record<string, JourneyExecutor>>;

/** Compose executors by exact touchpoint id without coupling the runner to a runtime. */
export function touchpointExecutor(executors: JourneyTouchpointExecutors): JourneyExecutor {
  const routes = new Map(Object.entries(executors));
  if (routes.size === 0) throw new Error("touchpointExecutor requires at least one touchpoint executor");
  return {
    ...routedExecutor((operation) => {
      const executor = routes.get(operation.touchpointId);
      if (!executor) throw new Error(`No executor for touchpoint ${operation.touchpointId} (operation ${operation.id})`);
      return executor;
    }),
    name: "@openuji/journey-runner/touchpoint-executor"
  };
}
