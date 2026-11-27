/**
 * Reusable iOS infrastructure operations: CoreSimulator (`simctl`) control,
 * simulator pool parsing, `.app` bundle inspection, installation checks, and
 * Xcode toolchain discovery. Service plugins compose them; this package
 * declares no plugin and knows no application vendor or executor.
 */
export * from "./simctl.js";
export * from "./pool.js";
export * from "./bundle.js";
export * from "./installation.js";
export * from "./xcode.js";
