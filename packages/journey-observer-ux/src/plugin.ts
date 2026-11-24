import { playwrightObservationContract } from "@openuji/journey-executor-playwright/observation";
import { defineExecutorObserverPlugin, knownOptions, optionsObject, requiredString, type JourneyPluginContext } from "@openuji/journey-plugin";
import { validateUXConfiguration, type UXConfiguration, type UXCounter, type UXCheckpoint, type UXProbe } from "./index.js";
import { uxObserver } from "./playwright.js";

function settings(options: Record<string, unknown>, context: JourneyPluginContext): UXConfiguration {
  knownOptions(options, ["id", "counters", "checkpoints", "probes"]);
  const list = <T>(key: string, keys: readonly string[], references: readonly string[]): T[] => {
    const values = options[key] ?? [];
    if (!Array.isArray(values)) throw new Error(`${key} must be an array`);
    return values.map((value) => {
      const item = optionsObject(value, key); knownOptions(item, keys);
      const result: Record<string, unknown> = { ...item, id: requiredString(item.id, `${key}.id`), label: requiredString(item.label, `${key}.label`) };
      for (const ref of references) result[ref] = context.resolveOperation(requiredString(item[ref], `${key}.${ref}`)).id;
      if (item.operations !== undefined) {
        if (!Array.isArray(item.operations)) throw new Error("operations must be an array");
        result.operations = item.operations.map((ref) => context.resolveOperation(requiredString(ref, "operation")).id);
      }
      if (item.status !== undefined && !["attempted", "completed", "failed"].includes(String(item.status))) throw new Error("Unknown action status");
      return result as T;
    });
  };
  const config = { id: requiredString(options.id, "id"), operations: context.operations,
    counters: list<UXCounter>("counters", ["id", "label", "from", "until", "operations", "status"], ["from", "until"]),
    checkpoints: list<UXCheckpoint>("checkpoints", ["id", "label", "operation"], ["operation"]),
    probes: list<UXProbe>("probes", ["id", "label", "at", "target"], ["at", "target"])
  };
  validateUXConfiguration(config);
  return config;
}
export const journeyMeshPlugin = defineExecutorObserverPlugin({
  kind: "executor-observer", observationContract: playwrightObservationContract,
  parse: settings,
  create(configuration) {
    const observer = uxObserver(configuration);
    return { observer, output: ({ result }) => observer.output(result) };
  }
});
