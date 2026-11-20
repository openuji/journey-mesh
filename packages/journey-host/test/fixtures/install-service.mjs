import { startedService, sourceCheckoutContract, sourceIdentityContract } from "@openuji/journey-plugin";
import { appendFile } from "node:fs/promises";
export const journeyMeshPlugin = {
  kind: "service", inputs: { source: sourceCheckoutContract }, outputs: { identity: sourceIdentityContract },
  parse: (options) => options,
  create(options, context, { inputs }) {
    return { name: "install", async start() {
      await appendFile(context.resolvePath("events"), "install-up\n");
      if (options.fail) { await appendFile(context.resolvePath("events"), "install-down\n"); throw new Error("installation failed"); }
      return startedService({ identity: { ...inputs.source.identity, version: "1.0" } }, undefined, async () => { await appendFile(context.resolvePath("events"), "install-down\n"); });
    } };
  }
};
