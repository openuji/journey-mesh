import { appendFile } from "node:fs/promises";
import { topic } from "./runtime-topic.mjs";
export const journeyMeshPlugin = {
  kind: "runtime-observer",
  parse(options, context) {
    if ("observations" in context || "artifacts" in context) throw new Error("runtime port leaked into parsing");
    if (options.invalid) throw new Error("invalid runtime observer");
    return options;
  },
  async create(options, context) {
    await appendFile(context.resolvePath("runtime-events"), "observer-created\n");
    let unsubscribe;
    return {
      start(source) {
        if (Object.keys(source).join() !== "subscribe" || typeof source.publisher === "function" || typeof source.close === "function") {
          throw new Error("runtime observers must receive a subscribe-only source");
        }
        unsubscribe = source.subscribe(topic, async ({ value }) => {
          await appendFile(context.resolvePath("runtime-events"), "captured\n");
          if (options.fail) throw new Error("runtime capture failed");
          // Asks for an hour; the suite's runtimeObserverTimeoutMs must still release the resource owner.
          if (options.hang) return new Promise(() => {});
          await context.artifacts.write({ name: "fixture.json", data: JSON.stringify(value), contentType: "application/json" });
        }, { name: "fixture observer", ...(options.hang ? { timeoutMs: 3_600_000 } : {}) });
        if (options.failStart) throw new Error("runtime observer startup failed");
      },
      async close() { unsubscribe?.(); await appendFile(context.resolvePath("runtime-events"), "observer-closed\n"); }
    };
  }
};
