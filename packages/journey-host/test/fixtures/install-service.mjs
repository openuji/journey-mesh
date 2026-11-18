import { sourceCheckoutContract, sourceIdentityContract } from "@openuji/journey-plugin";
import { appendFile } from "node:fs/promises";
export const journeyMeshPlugin = {
  kind: "service", inputs: { source: sourceCheckoutContract }, outputs: { identity: sourceIdentityContract },
  parse: (options) => options,
  create(options, context) {
    return { name: "install", async up({ inputs }) {
      await appendFile(context.resolvePath("events"), "install-up\n");
      if (options.fail) throw new Error("installation failed");
      return { identity: { ...inputs.source.identity, version: "1.0" } };
    }, async down() { await appendFile(context.resolvePath("events"), "install-down\n"); } };
  }
};
