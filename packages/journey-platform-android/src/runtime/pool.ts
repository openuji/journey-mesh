import { optionsObject, requiredString } from "@openuji/journey-plugin";
import { parseAndroidTarget, validateAndroidTarget, type AndroidRuntimeTarget } from "./android.js";

/**
 * The devices one service manages. A single top-level `avd` is the legacy form: one device named
 * `default` that also records `.runtime/android.env`. `devices` names several AVDs sharing the
 * same pins; they are reported only as the service's `devices` output.
 */
export type AndroidPool = Readonly<{ targets: Readonly<Record<string, AndroidRuntimeTarget>>; environmentFile: boolean }>;

export function parseAndroidPool(options: Record<string, unknown>): AndroidPool {
  if (options.devices === undefined) {
    const target = parseAndroidTarget(options);
    validateAndroidTarget(target);
    return Object.freeze({ targets: Object.freeze({ default: target }), environmentFile: true });
  }
  const { devices: raw, ...pins } = options;
  if (pins.avd !== undefined) throw new Error("android service takes either avd or devices, not both");
  const entries = Object.entries(optionsObject(raw, "devices"));
  if (!entries.length) throw new Error("devices must name at least one device");
  const avds = new Set<string>();
  const targets = Object.fromEntries(entries.map(([name, value]) => {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Device name ${name} must be lowercase letters, digits and dashes`);
    const device = optionsObject(value, `devices.${name}`);
    for (const key of Object.keys(device)) if (key !== "avd") throw new Error(`Unknown option devices.${name}.${key}`);
    const avd = requiredString(device.avd, `devices.${name}.avd`);
    if (avds.has(avd)) throw new Error(`AVD ${avd} is assigned to more than one device`);
    avds.add(avd);
    const target = parseAndroidTarget({ ...pins, avd });
    validateAndroidTarget(target);
    return [name, target];
  }));
  return Object.freeze({ targets: Object.freeze(targets), environmentFile: false });
}
