import { dirname } from "node:path";
import { androidDown, androidUp, parseAndroidTarget, validateAndroidTarget } from "./android.js";

// Re-exported so @openuji/journey-driver-android/runtime also serves as the
// single entry point for low-level helpers other packages legitimately reuse
// (e.g. journey-adapter-appium locates the Android SDK the same way, and an
// example's own validation script reuses validateAndroidTarget).
export * from "./android.js";

type JourneyAdapterRuntime = {
  readonly name: string;
  up(): Promise<void>;
  down?(): Promise<void>;
};

type RuntimePluginContext = { readonly configPath: string };

export const journeyMeshPlugin = {
  apiVersion: 1 as const,
  kind: "runtime" as const,
  validate(options: Record<string, unknown>): void {
    validateAndroidTarget(parseAndroidTarget(options));
  },
  create(options: Record<string, unknown>, context: RuntimePluginContext): JourneyAdapterRuntime {
    // Resolve relative to the YAML config's own directory, not the invoking
    // shell's cwd: `journey-mesh runtime up` is documented to run from the
    // repository root with a full path to the config. The device pins
    // (api/avd/image/profile/...) come straight from these options — there is
    // no separate manifest file to keep in sync.
    const root = dirname(context.configPath);
    const target = parseAndroidTarget(options);
    return Object.freeze({
      name: "android",
      async up(): Promise<void> { await androidUp({ root, target }); },
      async down(): Promise<void> { await androidDown({ root, avd: target.avd }); }
    });
  }
};
