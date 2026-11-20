import { sourceIdentityContract } from "@openuji/journey-plugin";
import { appendFile } from "node:fs/promises";

/** Parsing sees names; the constructor receives a frozen input snapshot. */
export const journeyMeshPlugin = {
  kind: "adapter", automation: { id: "fixture" }, optionalInputs: { installed: sourceIdentityContract },
  parse(options, context, metadata) {
    if ("inputs" in context || "artifacts" in context) throw new Error("Runtime ports leaked into parsing");
    return { ...options, configured: metadata.names };
  },
  create(settings, context, { inputs }) {
    if (settings.failConstruction) throw new Error("output-dependent construction failure");
    if (!Object.isFrozen(inputs) || (inputs.installed && !Object.isFrozen(inputs.installed))) throw new Error("Inputs are mutable");
    const log = (line) => appendFile(context.resolvePath("events"), line + "\n");
    return {
      name: "input-fixture",
      createExecution() {
        return {
          async start() {
            await log(`configured: ${settings.configured.join(",")}`);
            if (inputs.installed) await log(`installed: ${inputs.installed.sourceSha}`);
          },
          openEntry() {}, assertState() {}, performTransition() {}, recordControlFlow() {}, close() {}
        };
      }
    };
  }
};
