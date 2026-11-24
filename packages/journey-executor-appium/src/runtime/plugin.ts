import { readFile } from "node:fs/promises";
import { ownershipPath, readJsonRecord, writeJsonRecord, publishText, releaseText, type TextPublication } from "@openuji/journey-plugin/node";
import { dirname, resolve } from "node:path";
import { androidDevicesContract, type AndroidDevices } from "@openuji/journey-platform-android";
import { defineServicePlugin, knownOptions, startedService, type JourneyPluginContext } from "@openuji/journey-plugin";
import { appiumServerContract } from "../server.js";
import { appiumDown, appiumUp, type AppiumState } from "./appium.js";

export * from "./appium.js";
export * from "./appium-server.js";

function optionPort(value: unknown): number | undefined {
  if (value === undefined || value === "") return undefined;
  const port = typeof value === "string" ? Number(value) : value;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("port must be an integer from 1 through 65535");
  return port;
}

/**
 * Manages the local Appium server; requires the Android devices to be up. With the optional
 * `devices` input it checks those devices; without it, the device recorded in `.runtime/android.env`.
 * One server drives every device: UiAutomator2 assigns each session its own system port.
 */
export const journeyMeshPlugin = defineServicePlugin({
  kind: "service",
  optionalInputs: { devices: androidDevicesContract },
  outputs: { server: appiumServerContract },
  parse(options, context) {
    knownOptions(options, ["port"]);
    // Resolve relative to the YAML config's own directory, not the invoking shell's cwd.
    return { root: dirname(context.configPath), port: optionPort(options.port) };
  },
  create({ root, port }, context, { inputs }) {
    return Object.freeze({
      name: "appium",
      async start({ signal }) {
        const devices = inputs.devices as AndroidDevices | undefined;
        const legacy = devices ? undefined : await readFile(resolve(root, ".runtime/android.env"), "utf8");
        const udids = devices ? Object.values(devices).map((device) => device.udid) : [legacy?.match(/^ANDROID_UDID=(.+)$/m)?.[1] ?? ""];
        if (udids.some((id) => !id)) throw new Error("Android service did not provide a device");
        const statePath = ownershipPath(context.configPath, context.componentId);
        const state = await appiumUp({ root, port, devices: udids, statePath, abortSignal: signal });
        if (!state.owned) return startedService({ server: { url: state.url } });
        const path = ownershipPath(context.configPath, context.componentId);
        let publication: TextPublication | undefined;
        const release = async () => {
          const recorded = await readJsonRecord<AppiumState>(path);
          if (!recorded || recorded.pid !== state.pid) return;
          await appiumDown({ root, statePath: path, state });
          if (publication) await releaseText(publication);
        };
        try {
          publication = await publishText(resolve(root, ".runtime/appium.env"), `APPIUM_URL=${state.url}\n`);
          await writeJsonRecord(path, { ...state, publication });
          return startedService({ server: { url: state.url } }, { port: state.port }, release);
        } catch (error) {
          try { await release(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Appium publication and cleanup failed"); }
          throw error;
        }
      }
    });
  },
  async stopConfigured(context: JourneyPluginContext) {
    const path = ownershipPath(context.configPath, context.componentId);
    const state = await readJsonRecord<AppiumState & { publication?: TextPublication }>(path);
    await appiumDown({ root: dirname(context.configPath), statePath: path });
    if (state?.publication) await releaseText(state.publication);
  }
});
