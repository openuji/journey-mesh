import { optionsObject, requiredString } from "@openuji/journey-plugin";
import { parseIosTarget, validateIosTarget, type IosRuntimeTarget } from "./simctl.js";

/**
 * The simulators one service manages. A single top-level `simulator` is the single-device form:
 * one device named `default` that also records `.runtime/ios.env`. `devices` names several
 * simulators sharing the same pins; they are reported only as the service's `devices` output.
 */
export type IosPool = Readonly<{ targets: Readonly<Record<string, IosRuntimeTarget>>; environmentFile: boolean }>;

export function parseIosPool(options: Record<string, unknown>): IosPool {
  if (options.devices === undefined) {
    const target = parseIosTarget(options);
    validateIosTarget(target);
    return Object.freeze({ targets: Object.freeze({ default: target }), environmentFile: true });
  }
  const { devices: raw, ...pins } = options;
  if (pins.simulator !== undefined) throw new Error("ios service takes either simulator or devices, not both");
  const entries = Object.entries(optionsObject(raw, "devices"));
  if (!entries.length) throw new Error("devices must name at least one device");
  const simulators = new Set<string>();
  const targets = Object.fromEntries(entries.map(([name, value]) => {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Device name ${name} must be lowercase letters, digits and dashes`);
    const device = optionsObject(value, `devices.${name}`);
    for (const key of Object.keys(device)) if (key !== "simulator") throw new Error(`Unknown option devices.${name}.${key}`);
    const simulator = requiredString(device.simulator, `devices.${name}.simulator`);
    if (simulators.has(simulator)) throw new Error(`Simulator ${simulator} is assigned to more than one device`);
    simulators.add(simulator);
    const target = parseIosTarget({ ...pins, simulator });
    validateIosTarget(target);
    return [name, target];
  }));
  return Object.freeze({ targets: Object.freeze(targets), environmentFile: false });
}
