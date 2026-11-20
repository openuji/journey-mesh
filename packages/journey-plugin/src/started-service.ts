import { immutableSnapshot } from "@openuji/journey-core";
import type { StartedService } from "./plugins.js";

/** Pure construction of an acquisition result; only release is effectful. */
export function startedService(outputs: Readonly<Record<string, unknown>> = {}, provenance?: unknown, release: () => Promise<void> = async () => {}): StartedService {
  return Object.freeze({ outputs: immutableSnapshot(outputs), ...(provenance === undefined ? {} : { provenance: immutableSnapshot(provenance) }), release });
}
