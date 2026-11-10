import { dirname } from "node:path";
import { appiumDown, appiumUp } from "./appium.js";

export * from "./appium.js";
export * from "./appium-server.js";

type JourneyAdapterRuntime = {
  readonly name: string;
  up(): Promise<void>;
  down?(): Promise<void>;
};

type RuntimePluginContext = { readonly configPath: string };

function optionPort(value: unknown): number | undefined {
  if (value === undefined || value === "") return undefined;
  const port = typeof value === "string" ? Number(value) : value;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be an integer from 1 through 65535");
  return port;
}

export const journeyMeshPlugin = {
  apiVersion: 1 as const,
  kind: "runtime" as const,
  validate(options: Record<string, unknown>): void {
    optionPort(options.port);
  },
  create(options: Record<string, unknown>, context: RuntimePluginContext): JourneyAdapterRuntime {
    // Resolve relative to the YAML config's own directory, not the invoking
    // shell's cwd — matches @openuji/journey-driver-android/runtime.
    const root = dirname(context.configPath);
    const port = optionPort(options.port);
    return Object.freeze({
      name: "appium",
      async up(): Promise<void> { await appiumUp({ root, port }); },
      async down(): Promise<void> { await appiumDown({ root }); }
    });
  }
};
