import { dirname } from "node:path";
import { defineServicePlugin } from "@openuji/journey-plugin";
import { androidDown, androidUp, parseAndroidTarget, validateAndroidTarget } from "./android.js";

// Re-exported so @openuji/journey-driver-android/service also serves as the
// single entry point for low-level helpers other packages legitimately reuse
// (e.g. journey-adapter-appium locates the Android SDK the same way, and an
// example's own validation script reuses validateAndroidTarget).
export * from "./android.js";

/** Manages the pinned Android emulator. The device pins come straight from these options. */
export const journeyMeshPlugin = defineServicePlugin({
  kind: "service",
  parse(options, context) {
    const target = parseAndroidTarget(options);
    validateAndroidTarget(target);
    // Resolve relative to the YAML config's own directory, not the invoking shell's cwd.
    return { root: dirname(context.configPath), target };
  },
  create({ root, target }) {
    return Object.freeze({
      name: "android",
      async up(): Promise<void> { await androidUp({ root, target }); },
      async down(): Promise<void> { await androidDown({ root, avd: target.avd }); }
    });
  }
});
