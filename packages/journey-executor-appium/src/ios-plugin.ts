import { verifyAppBundleChecksum, verifyInstalledIosApp } from "@openuji/journey-toolkit-ios/installation";
import { bundleSha256 } from "@openuji/journey-toolkit-ios";
import { iosAppContract, iosClientContract, iosDevicesContract, type IosAppBundle, type IosDevices } from "@openuji/journey-platform-ios";
import { defineExecutorPlugin, knownOptions, optionalString, optionsObject, positiveNumber, requiredString } from "@openuji/journey-plugin";
import type { AppiumConnection } from "./contracts.js";
import { appiumIosExecutor, validateAppiumIosOperation } from "./ios.js";
import { appiumIosObservationContract } from "./observation-contract.js";
import { appiumServerContract, type AppiumServer } from "./server.js";

function endpoint(value: unknown): URL {
  if (typeof value !== "string") throw new Error("Appium endpoint must be an HTTP(S) URL");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Appium endpoint must be an HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Appium endpoint must be an HTTP(S) URL without credentials, query or fragment");
  }
  return url;
}

function connection(url: URL): AppiumConnection {
  return {
    hostname: url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    protocol: url.protocol === "https:" ? "https" : "http",
    path: url.pathname
  };
}

type IosApplicationSource =
  | Readonly<{ kind: "local"; app: string; sha256?: string }>
  | Readonly<{ kind: "input" }>;

type DeviceSource = Readonly<{ udid?: string; device?: string; capabilities: Readonly<Record<string, unknown>> }>;

function parseApplication(options: Record<string, unknown>, inputs: readonly string[], resolvePath: (path: string) => string) {
  const raw = optionsObject(options.application, "application");
  knownOptions(raw, ["bundleId", "app", "sha256"]);
  const identity = { bundleId: requiredString(raw.bundleId, "application.bundleId") };
  if (inputs.includes("application")) {
    for (const key of ["app", "sha256"]) if (raw[key] !== undefined) throw new Error(`application.${key} conflicts with the application input`);
    if (options.app !== undefined || options.appDirectory !== undefined) throw new Error("app and appDirectory conflict with the application input");
    return { ...identity, source: Object.freeze({ kind: "input" }) as IosApplicationSource };
  }
  const appName = requiredString(raw.app, "application.app");
  const resolvedApp = resolvePath(
    typeof options.app === "string" && options.app
      ? options.app
      : options.appDirectory !== undefined
        ? `${requiredString(options.appDirectory, "appDirectory")}/${appName}`
        : appName
  );
  const sha256 = optionalString(raw.sha256, "application.sha256");
  return {
    ...identity,
    source: Object.freeze({ kind: "local", app: resolvedApp, ...(sha256 ? { sha256 } : {}) }) as IosApplicationSource
  };
}

function parseDevices(options: Record<string, unknown>, inputs: readonly string[]): Readonly<Record<string, DeviceSource>> {
  return Object.freeze(Object.fromEntries(Object.entries(optionsObject(options.devices, "devices")).map(([id, value]) => {
    const device = optionsObject(value, `device ${id}`);
    knownOptions(device, ["udid", "device", "capabilities"]);
    if ((device.udid === undefined) === (device.device === undefined)) throw new Error(`device ${id} needs exactly one of udid or device`);
    if (device.device !== undefined && !inputs.includes("devices")) throw new Error(`device ${id}.device requires the devices input`);
    return [id, Object.freeze({
      ...(device.udid !== undefined ? { udid: requiredString(device.udid, `device ${id}.udid`) } : { device: requiredString(device.device, `device ${id}.device`) }),
      capabilities: optionsObject(device.capabilities ?? {}, `device ${id}.capabilities`)
    })];
  })));
}

export const journeyMeshPlugin = defineExecutorPlugin({
  kind: "executor",
  observationContract: appiumIosObservationContract,
  clientContract: iosClientContract,
  optionalInputs: { application: iosAppContract, server: appiumServerContract, devices: iosDevicesContract },
  parse(options, context, { names } = { names: [] }) {
    knownOptions(options, ["endpoint", "assertionTimeoutMs", "pollIntervalMs", "application", "appDirectory", "app", "devices"]);
    const application = parseApplication(options, names, context.resolvePath);
    const devices = parseDevices(options, names);
    for (const operation of context.operations) if (!devices[operation.touchpointId]) throw new Error(`Missing device for touchpoint ${operation.touchpointId}`);
    if (names.includes("server") && options.endpoint !== undefined) throw new Error("endpoint conflicts with the server input");
    return {
      application,
      devices,
      ...(names.includes("server") ? {} : { endpoint: endpoint(options.endpoint ?? "http://127.0.0.1:4725/").href }),
      assertionTimeoutMs: positiveNumber(options.assertionTimeoutMs, 60_000),
      pollIntervalMs: positiveNumber(options.pollIntervalMs, 200)
    };
  },
  validateOperations(_settings, context, { client }) {
    if (!client) throw new Error("Appium iOS requires a client");
    for (const operation of context.operations) validateAppiumIosOperation(operation);
  },
  create({ endpoint: url, application, devices, assertionTimeoutMs, pollIntervalMs }, context, { client, observers, inputs }) {
    if (!client) throw new Error("Appium iOS requires a client");
    const { source } = application;
    const built = source.kind === "input" ? inputs.application as IosAppBundle : undefined;
    if (source.kind === "input" && !built) throw new Error("Missing application input");
    if (built && built.bundleId !== application.bundleId) {
      throw new Error(`The application input is ${built.bundleId}, not ${application.bundleId}`);
    }
    const pool = inputs.devices as IosDevices | undefined;
    const resolvedDevices = Object.fromEntries(Object.entries(devices).map(([touchpoint, device]) => {
      const udid = device.udid ?? pool?.[device.device!]?.udid;
      if (!udid) throw new Error(`The devices input has no device ${device.device} for ${touchpoint}`);
      return [touchpoint, { udid, capabilities: device.capabilities }];
    }));
    const serverUrl = endpoint((inputs.server as AppiumServer | undefined)?.url ?? url);
    if (built && (!pool || !["localhost", "127.0.0.1", "[::1]"].includes(serverUrl.hostname))) {
      throw new Error("Built iOS app verification requires local Appium and the managed devices input");
    }
    if (built && Object.values(resolvedDevices).some((device) => !Object.values(pool!).some((managed) => managed.udid === device.udid))) {
      throw new Error("Built iOS app devices must belong to the managed devices input");
    }
    const prepare = async (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (source.kind === "local") {
        const digest = await bundleSha256(source.app);
        if (source.sha256 && digest !== source.sha256) {
          throw new Error("iOS app bundle checksum does not match the pinned configuration");
        }
      } else {
        await verifyAppBundleChecksum(built!);
      }
    };
    return appiumIosExecutor({
      client,
      executionObservers: observers,
      assertionTimeoutMs,
      pollIntervalMs,
      prepare,
      application: {
        app: built?.path ?? (source as Extract<IosApplicationSource, { kind: "local" }>).app,
        bundleId: application.bundleId
      },
      devices: resolvedDevices,
      connection: connection(serverUrl),
      ...(built ? {
        verifyInstallation: async ({ udid, execution, signal }) => {
          const evidence = await verifyInstalledIosApp(built, udid, { signal });
          await context.artifacts.write({
            name: `ios-installation/${encodeURIComponent(execution.executionId)}/${encodeURIComponent(udid)}.json`,
            data: JSON.stringify(evidence, null, 2) + "\n",
            contentType: "application/json",
            format: "journey-mesh/ios-installation",
            scope: { runId: execution.runId, executionId: execution.executionId, profileId: execution.profile.id }
          });
          if (!evidence.matches) throw new Error(`Installed iOS app differs from the built application on ${udid}`);
        }
      } : {})
    });
  }
});
