import { readFile } from "node:fs/promises";
import { ownershipPath, readJsonRecord, writeJsonRecord, publishText, releaseText, type TextPublication } from "@openuji/journey-plugin/node";
import { dirname, resolve } from "node:path";
import { iosDevicesContract, type IosDevices } from "@openuji/journey-platform-ios";
import { defineServicePlugin, knownOptions, startedService, type JourneyPluginContext } from "@openuji/journey-plugin";
import { appiumServerContract } from "../server.js";
import { appiumDown, type AppiumState } from "./appium.js";
import { appiumIosUp } from "./appium-ios.js";

export * from "./appium-ios.js";

function optionPort(value: unknown): number | undefined {
  if (value === undefined || value === "") return undefined;
  const port = typeof value === "string" ? Number(value) : value;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("port must be an integer from 1 through 65535");
  }
  return port;
}

/**
 * Manages the local Appium server for iOS (XCUITest); requires target simulators to be booted.
 * With the optional `devices` input it checks those simulators; without it, the simulator UDID
 * recorded in `.runtime/ios.env`. Publishes `APPIUM_IOS_URL` to `.runtime/appium-ios.env`.
 */
export const journeyMeshPlugin = defineServicePlugin({
  kind: "service",
  optionalInputs: { devices: iosDevicesContract },
  outputs: { server: appiumServerContract },
  parse(options, context) {
    knownOptions(options, ["port"]);
    return { root: dirname(context.configPath), port: optionPort(options.port) };
  },
  create({ root, port }, context, { inputs }) {
    return Object.freeze({
      name: "appium-ios",
      async start({ signal }) {
        const devices = inputs.devices as IosDevices | undefined;
        const legacy = devices ? undefined : await readFile(resolve(root, ".runtime/ios.env"), "utf8");
        const udids = devices ? Object.values(devices).map((device) => device.udid) : [legacy?.match(/^IOS_UDID=(.+)$/m)?.[1] ?? ""];
        if (udids.some((id) => !id)) throw new Error("iOS simulator service did not provide a device");
        const statePath = ownershipPath(context.configPath, context.componentId);
        const state = await appiumIosUp({ root, port, devices: udids, statePath, abortSignal: signal });
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
          publication = await publishText(resolve(root, ".runtime/appium-ios.env"), `APPIUM_IOS_URL=${state.url}\n`);
          await writeJsonRecord(path, { ...state, publication });
          return startedService({ server: { url: state.url } }, { port: state.port }, release);
        } catch (error) {
          try { await release(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Appium iOS publication and cleanup failed"); }
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
