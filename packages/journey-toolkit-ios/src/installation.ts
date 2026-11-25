import { runOwnedProcess } from "@openuji/journey-plugin/node";
import type { IosAppBundle } from "@openuji/journey-platform-ios";
import { bundleSha256, readBundleInfoPlist } from "./bundle.js";

export async function verifyAppBundleChecksum(app: IosAppBundle): Promise<void> {
  if (await bundleSha256(app.path) !== app.sha256) {
    throw new Error("Built iOS app bundle checksum differs from its service output");
  }
}

export type InstalledIosAppIdentity = Readonly<Pick<IosAppBundle, "bundleId" | "bundleVersion" | "bundleShortVersionString" | "sha256">>;
export type InstalledIosAppInspector = (udid: string, bundleId: string, signal?: AbortSignal) => Promise<InstalledIosAppIdentity>;

/** Local `simctl` port: inspects the installed `.app` container directly on the booted simulator. */
export const inspectInstalledIosApp: InstalledIosAppInspector = async (udid, bundleId, signal) => {
  if (!/^[A-Za-z0-9_.-]+$/.test(bundleId)) throw new Error("Invalid iOS bundle identifier");
  const containerPath = (await runOwnedProcess("xcrun", ["simctl", "get_app_container", udid, bundleId, "app"], {
    signal,
    stdoutOnly: true,
    timeoutMs: 30_000
  })).trim();
  if (!containerPath) throw new Error(`Expected installed app container for ${bundleId} on ${udid}`);
  const info = await readBundleInfoPlist(containerPath, { signal });
  return Object.freeze({ ...info, sha256: await bundleSha256(containerPath) });
};

export async function verifyInstalledIosApp(
  expected: IosAppBundle,
  udid: string,
  options: { signal?: AbortSignal; inspect?: InstalledIosAppInspector } = {}
) {
  options.signal?.throwIfAborted();
  const actual = await (options.inspect ?? inspectInstalledIosApp)(udid, expected.bundleId, options.signal);
  const { bundleId, bundleVersion, bundleShortVersionString, sha256 } = expected;
  const subject = Object.freeze({ bundleId, bundleVersion, bundleShortVersionString, sha256 });
  return Object.freeze({
    version: 1,
    udid,
    expected: subject,
    observed: actual,
    matches: actual.bundleId === bundleId
      && actual.bundleVersion === bundleVersion
      && actual.bundleShortVersionString === bundleShortVersionString
      && actual.sha256 === sha256
  });
}
