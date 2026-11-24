import { verifyInstalledApk, verifyApkChecksum } from "@openuji/journey-toolkit-android/installation";
import { androidApkContract, androidDevicesContract, androidClientContract, type AndroidApk, type AndroidDevices } from "@openuji/journey-platform-android";
import { defineExecutorPlugin, knownOptions, optionsObject, positiveNumber, requiredString } from "@openuji/journey-plugin";
import { ensureApk } from "./application.js";
import { appiumAndroidObservationContract } from "./observation-contract.js";
import { appiumExecutor, validateAppiumOperation, type AppiumConnection } from "./index.js";
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
  return { hostname: url.hostname, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)), protocol: url.protocol === "https:" ? "https" : "http", path: url.pathname };
}

/** A pinned download, or the `application` input (e.g. an APK built from a pull request). */
type ApplicationSource = Readonly<{ kind: "pinned"; apk: string; url: string; sha256: string }> | Readonly<{ kind: "input" }>;
/** A touchpoint's device: a fixed UDID, or a named device of the `devices` input. */
type DeviceSource = Readonly<{ udid?: string; device?: string; capabilities: Readonly<Record<string, unknown>> }>;

function parseApplication(options: Record<string, unknown>, inputs: readonly string[], resolvePath: (path: string) => string) {
  const raw = optionsObject(options.application, "application");
  const identity = { package: requiredString(raw.package, "application.package"), activity: requiredString(raw.activity, "application.activity") };
  if (inputs.includes("application")) {
    for (const key of ["apk", "url", "sha256"]) if (raw[key] !== undefined) throw new Error(`application.${key} conflicts with the application input`);
    if (options.apk !== undefined || options.apkDirectory !== undefined) throw new Error("apk and apkDirectory conflict with the application input");
    return { ...identity, source: Object.freeze({ kind: "input" }) as ApplicationSource };
  }
  const apk = requiredString(raw.apk, "application.apk");
  return { ...identity, source: Object.freeze({
    kind: "pinned", url: requiredString(raw.url, "application.url"), sha256: requiredString(raw.sha256, "application.sha256"),
    apk: resolvePath(typeof options.apk === "string" && options.apk ? options.apk : `${requiredString(options.apkDirectory, "apkDirectory")}/${apk}`)
  }) as ApplicationSource };
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

/**
 * Inputs are optional: `application` replaces the pinned APK download, `server` the endpoint, and
 * `devices` lets a touchpoint name a booted device instead of a UDID. All resolve when the first execution starts.
 */
export const journeyMeshPlugin = defineExecutorPlugin({
  kind: "executor", observationContract: appiumAndroidObservationContract, clientContract: androidClientContract,
  optionalInputs: { application: androidApkContract, server: appiumServerContract, devices: androidDevicesContract },
  parse(options, context, { names } = { names: [] }) {
    knownOptions(options, ["endpoint", "assertionTimeoutMs", "pollIntervalMs", "application", "apkDirectory", "apk", "devices"]);
    const application = parseApplication(options, names, context.resolvePath);
    const devices = parseDevices(options, names);
    for (const operation of context.operations) if (!devices[operation.touchpointId]) throw new Error(`Missing device for touchpoint ${operation.touchpointId}`);
    if (names.includes("server") && options.endpoint !== undefined) throw new Error("endpoint conflicts with the server input");
    return {
      application, devices,
      ...(names.includes("server") ? {} : { endpoint: endpoint(options.endpoint ?? "http://127.0.0.1:4723/").href }),
      assertionTimeoutMs: positiveNumber(options.assertionTimeoutMs, 60_000),
      pollIntervalMs: positiveNumber(options.pollIntervalMs, 200)
    };
  },
  validateOperations(_settings, context, { client }) {
    if (!client) throw new Error("Appium requires a client");
    for (const operation of context.operations) { validateAppiumOperation(operation); }
  },
  create({ endpoint: url, application, devices, assertionTimeoutMs, pollIntervalMs }, context, { client, observers, inputs }) {
    if (!client) throw new Error("Appium requires a client");
    const { source } = application;
    const built = source.kind === "input" ? inputs.application as AndroidApk : undefined;
    if (source.kind === "input" && !built) throw new Error("Missing application input");
    if (built && built.package !== application.package) throw new Error(`The application input is ${built.package}, not ${application.package}`);
    const pool = inputs.devices as AndroidDevices | undefined;
    const resolvedDevices = Object.fromEntries(Object.entries(devices).map(([touchpoint, device]) => {
      const udid = device.udid ?? pool?.[device.device!]?.udid;
      if (!udid) throw new Error(`The devices input has no device ${device.device} for ${touchpoint}`);
      return [touchpoint, { udid, capabilities: device.capabilities }];
    }));
    const serverUrl = endpoint((inputs.server as AppiumServer | undefined)?.url ?? url);
    if (built && (!pool || !["localhost", "127.0.0.1", "[::1]"].includes(serverUrl.hostname))) throw new Error("Built APK verification requires local Appium and the managed devices input");
    if (built && Object.values(resolvedDevices).some((device) => !Object.values(pool!).some((managed) => managed.udid === device.udid))) throw new Error("Built APK devices must belong to the managed devices input");
    const prepare = async (signal?: AbortSignal) => {
      if (source.kind === "pinned") await ensureApk({ path: source.apk, url: source.url, sha256: source.sha256, signal });
      else await verifyApkChecksum(built!);
    };
    return appiumExecutor({
      client, executionObservers: observers, assertionTimeoutMs, pollIntervalMs, prepare,
      application: { apk: built?.path ?? (source as Extract<ApplicationSource, { kind: "pinned" }>).apk, package: application.package, activity: application.activity },
      devices: resolvedDevices, connection: connection(serverUrl), preserveApkSignature: !!built,
      ...(built ? { verifyInstallation: async ({ udid, execution, signal }) => {
        const evidence = await verifyInstalledApk(built, udid, { signal });
        await context.artifacts.write({ name: `android-installation/${encodeURIComponent(execution.executionId)}/${encodeURIComponent(udid)}.json`,
          data: JSON.stringify(evidence, null, 2) + "\n", contentType: "application/json", format: "journey-mesh/android-installation",
          scope: { runId: execution.runId, executionId: execution.executionId, profileId: execution.profile.id } });
        if (!evidence.matches) throw new Error(`Installed APK differs from the built application on ${udid}`);
      } } : {})
    });
  }
});
