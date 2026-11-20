import { immutableSnapshot } from "@openuji/journey-core";
import type { Contract, InputDeclarations, ResolvedInputs } from "@openuji/journey-plugin";
import type { ServiceOutputRef } from "./config/schema.js";

export type ServiceValues = Readonly<Record<string, Readonly<Record<string, unknown>>>>;
export type ServiceContracts = Readonly<Record<string, Readonly<Record<string, Contract<unknown>>>>>;

/** Pure preflight validation, shared by service and adapter references. */
export function validateInputs(plugin: InputDeclarations, refs: Readonly<Record<string, ServiceOutputRef>>, contracts: ServiceContracts, label: string): void {
  for (const name of Object.keys(plugin.inputs ?? {})) if (!Object.hasOwn(refs, name)) throw new Error(`${label}.inputs.${name} is required`);
  for (const [name, ref] of Object.entries(refs)) {
    const expected = plugin.inputs?.[name] ?? plugin.optionalInputs?.[name];
    if (!expected) throw new Error(`${label}.inputs.${name} is not an input of this plugin`);
    const provided = contracts[ref.service]?.[ref.output];
    if (!provided || expected.id !== provided.id) throw new Error(`Invalid or incompatible ${label.startsWith("adapters.") ? "adapter" : "service"} input ${label}.inputs.${name}`);
  }
}

/** No binding, lookup accessor, registry update, or captured phase-dependent state. */
export function resolveInputs(refs: Readonly<Record<string, ServiceOutputRef>>, values: ServiceValues): ResolvedInputs {
  return immutableSnapshot(Object.fromEntries(Object.entries(refs).map(([name, ref]) => {
    const outputs = values[ref.service];
    if (!outputs || !Object.hasOwn(outputs, ref.output)) throw new Error(`Missing service output ${ref.service}.${ref.output}`);
    return [name, outputs[ref.output]];
  })));
}
