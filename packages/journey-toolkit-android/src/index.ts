/**
 * Reusable Android infrastructure operations: SDK and JDK discovery, ADB and emulator control,
 * device pool parsing, APK inspection and installation checks. Service plugins compose them;
 * this package declares no plugin and knows no application vendor or executor.
 */
export * from "./sdk.js";
export * from "./pool.js";
export * from "./apk.js";
export * from "./installation.js";
export * from "./gradle.js";
