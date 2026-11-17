import { dirname } from "node:path";
import { defineServicePlugin, knownOptions } from "@openuji/journey-plugin";
import { appiumDown, appiumUp } from "./appium.js";

export * from "./appium.js";
export * from "./appium-server.js";

function optionPort(value: unknown): number | undefined {
  if (value === undefined || value === "") return undefined;
  const port = typeof value === "string" ? Number(value) : value;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be an integer from 1 through 65535");
  return port;
}

/** Manages the local Appium server; requires the Android emulator service to be up. */
export const journeyMeshPlugin = defineServicePlugin({
  kind: "service",
  parse(options, context) {
    knownOptions(options, ["port"]);
    // Resolve relative to the YAML config's own directory, not the invoking shell's cwd.
    return { root: dirname(context.configPath), port: optionPort(options.port) };
  },
  create({ root, port }) {
    return Object.freeze({
      name: "appium",
      async up(): Promise<void> { await appiumUp({ root, port }); },
      async down(): Promise<void> { await appiumDown({ root }); }
    });
  }
});
