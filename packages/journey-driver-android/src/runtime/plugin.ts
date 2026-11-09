import { dirname } from "node:path";
import { androidDown, androidUp } from "./android.js";

// Re-exported so @openuji/journey-driver-android/runtime also serves as the
// single entry point for low-level helpers other packages legitimately reuse
// (e.g. journey-adapter-appium locates the Android SDK the same way).
export * from "./android.js";

type JourneyAdapterRuntime = {
  readonly name: string;
  up(): Promise<void>;
  down?(): Promise<void>;
};

/** Minimal structural subset of JourneyPluginContext actually used here. */
type RuntimePluginContext = { readonly configPath: string };

function optionString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

export const journeyMeshPlugin = {
  apiVersion: 1 as const,
  kind: "runtime" as const,
  validate(options: Record<string, unknown>): void {
    optionString(options.avd, "avd");
    optionString(options.manifestPath, "manifestPath");
  },
  create(options: Record<string, unknown>, context: RuntimePluginContext): JourneyAdapterRuntime {
    // Resolve relative to the YAML config's own directory, not the
    // invoking shell's cwd: `journey-mesh runtime up` is documented to run
    // from the repository root with a full path to the config.
    const root = dirname(context.configPath);
    const avd = optionString(options.avd, "avd");
    const manifestPath = optionString(options.manifestPath, "manifestPath") ?? "android/runtime.json";
    return Object.freeze({
      name: "android",
      async up(): Promise<void> { await androidUp({ root, manifestPath, avd }); },
      async down(): Promise<void> { await androidDown({ root, manifestPath, avd }); }
    });
  }
};
