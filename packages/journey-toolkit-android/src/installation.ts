import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOwnedProcess } from "@openuji/journey-plugin/node";
import type { AndroidApk } from "@openuji/journey-platform-android";
import { findSdk } from "./sdk.js";
import { parseBadging } from "./apk.js";

export async function apkChecksum(path: string): Promise<string> { return createHash("sha256").update(await readFile(path)).digest("hex"); }
export async function verifyApkChecksum(apk: AndroidApk): Promise<void> {
  if (await apkChecksum(apk.path) !== apk.sha256) throw new Error("Built APK checksum differs from its service output");
}
export type InstalledApkIdentity = Readonly<Pick<AndroidApk, "package" | "versionCode" | "versionName" | "sha256">>;
export type InstalledApkInspector = (udid: string, packageName: string, signal?: AbortSignal) => Promise<InstalledApkIdentity>;
/** Local ADB port: no Appium shell extension or remote-server assumption. */
export const inspectInstalledApk: InstalledApkInspector = async (udid, packageName, signal) => {
  if (!/^[A-Za-z0-9_.]+$/.test(packageName)) throw new Error("Invalid Android package name");
  const sdk = await findSdk();
  const adb = join(sdk, "platform-tools/adb");
  const run = (command: string, args: readonly string[]) => runOwnedProcess(command, args, { signal, timeoutMs: 30000 });
  const packages = (await run(adb, ["-s", udid, "shell", "pm", "path", packageName])).split(/\r?\n/).filter((line) => line.startsWith("package:"));
  if (packages.length !== 1) throw new Error(`Expected one installed base APK for ${packageName}; found ${packages.length}`);
  const tools = (await readdir(join(sdk, "build-tools"))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (!tools.length) throw new Error("Android build-tools are required to inspect the installed APK");
  const work = await mkdtemp(join(tmpdir(), "journey-installed-apk-"));
  try {
    const path = join(work, "base.apk");
    await run(adb, ["-s", udid, "pull", packages[0]!.slice("package:".length), path]);
    return Object.freeze({ ...parseBadging(await run(join(sdk, "build-tools", tools[0]!, "aapt2"), ["dump", "badging", path])), sha256: await apkChecksum(path) });
  } finally { await rm(work, { recursive: true, force: true }); }
};
export async function verifyInstalledApk(expected: AndroidApk, udid: string, options: { signal?: AbortSignal; inspect?: InstalledApkInspector } = {}) {
  options.signal?.throwIfAborted();
  const actual = await (options.inspect ?? inspectInstalledApk)(udid, expected.package, options.signal);
  const { package: packageName, versionName, versionCode, sha256 } = expected;
  const subject = Object.freeze({ package: packageName, versionName, versionCode, sha256 });
  return Object.freeze({ version: 1, udid, expected: subject, observed: actual,
    matches: actual.package === packageName && actual.versionCode === versionCode && actual.versionName === versionName && actual.sha256 === sha256 });
}
