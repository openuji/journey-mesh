import { startedService } from "@openuji/journey-plugin";
import { appendFile } from "node:fs/promises";
import { topic } from "./runtime-topic.mjs";
export const journeyMeshPlugin = {
  kind: "service",
  parse: (options, context) => {
    if ("observations" in context) throw new Error("runtime port leaked into parsing");
    return options;
  },
  create(options, context) {
    return { name: "observable fixture", async start(input) {
      if ("observations" in input) throw new Error("services publish through their context, not a second start channel");
      const release = async () => {
        await context.observations.publish(topic, { phase: "before-release" });
        await appendFile(context.resolvePath("runtime-events"), "disposed\n");
      };
      if (options.fail) { await release(); throw new Error("startup failed"); }
      return startedService({}, undefined, release);
    } };
  }
};
