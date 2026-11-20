import { startedService, sourceCheckoutContract, sourceIdentityContract } from "@openuji/journey-plugin";
import { appendFile } from "node:fs/promises";
export const journeyMeshPlugin = {
  kind: "service", inputs: { source: sourceCheckoutContract }, optionalInputs: { sibling: sourceCheckoutContract },
  outputs: { identity: sourceIdentityContract },
  parse: (options) => options,
  create(_options, context, { inputs }) {
    return { name: "combine", async start() {
      await appendFile(context.resolvePath("events"), `combine-up sibling=${inputs.sibling ? "yes" : "no"}\n`);
      return startedService({ identity: { ...inputs.source.identity, version: "2.0" } }, undefined, async () => { await appendFile(context.resolvePath("events"), "combine-down\n"); });
    } };
  }
};
