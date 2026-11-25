import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join, posix } from "node:path";
import { runOwnedProcess } from "@openuji/journey-plugin/node";
import type { IosAppBundle } from "@openuji/journey-platform-ios";

export type AppBundleInfo = Pick<IosAppBundle, "bundleId" | "bundleVersion" | "bundleShortVersionString">;

function unescapeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/**
 * Parse `CFBundleIdentifier`, `CFBundleVersion`, and `CFBundleShortVersionString`
 * from either `plutil -convert json -o -` JSON output or an XML `Info.plist`.
 */
export function parseInfoPlist(source: string): AppBundleInfo {
  const trimmed = source.trim();
  let bundleId: string | undefined;
  let bundleVersion: string | undefined;
  let bundleShortVersionString: string | undefined;

  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.CFBundleIdentifier === "string") bundleId = parsed.CFBundleIdentifier;
    if (typeof parsed.CFBundleVersion === "string") bundleVersion = parsed.CFBundleVersion;
    if (typeof parsed.CFBundleShortVersionString === "string") bundleShortVersionString = parsed.CFBundleShortVersionString;
  } else {
    const xmlField = (key: string): string | undefined => {
      const pattern = new RegExp(`<key>\\s*${key}\\s*<\\/key>\\s*<string>([^<]*)<\\/string>`);
      const match = pattern.exec(trimmed);
      return match?.[1] !== undefined ? unescapeXml(match[1].trim()) : undefined;
    };
    bundleId = xmlField("CFBundleIdentifier");
    bundleVersion = xmlField("CFBundleVersion");
    bundleShortVersionString = xmlField("CFBundleShortVersionString");
  }

  if (!bundleId || !bundleVersion || !bundleShortVersionString) {
    throw new Error("Cannot read CFBundleIdentifier, CFBundleVersion and CFBundleShortVersionString from Info.plist");
  }
  return Object.freeze({ bundleId, bundleVersion, bundleShortVersionString });
}

/** Deterministic SHA-256 over all files and symlinks in a `.app` directory bundle. */
export async function bundleSha256(appPath: string): Promise<string> {
  const info = await lstat(appPath).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`iOS app bundle directory does not exist: ${appPath}`);
  const hash = createHash("sha256");

  async function walk(currentDir: string, prefix: string): Promise<void> {
    const entries = (await readdir(currentDir)).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    for (const name of entries) {
      const fullPath = join(currentDir, name);
      const relPath = prefix ? posix.join(prefix, name) : name;
      const entryStat = await lstat(fullPath);
      if (entryStat.isSymbolicLink()) {
        const target = await readlink(fullPath);
        hash.update(`symlink:${relPath}\0${target}\0`);
      } else if (entryStat.isDirectory()) {
        hash.update(`dir:${relPath}\0`);
        await walk(fullPath, relPath);
      } else if (entryStat.isFile()) {
        const bytes = await readFile(fullPath);
        hash.update(`file:${relPath}\0${bytes.byteLength}\0`);
        hash.update(bytes);
      }
    }
  }

  await walk(appPath, "");
  return hash.digest("hex");
}

export async function readBundleInfoPlist(
  appPath: string,
  options: { signal?: AbortSignal; convertPlist?: (plistPath: string, signal?: AbortSignal) => Promise<string> } = {}
): Promise<AppBundleInfo> {
  const plistPath = join(appPath, "Info.plist");
  const raw = await readFile(plistPath);
  const text = raw.subarray(0, 6).equals(Buffer.from("bplist"))
    ? await (options.convertPlist ?? ((path, signal) => runOwnedProcess("plutil", ["-convert", "json", "-o", "-", path], { signal, stdoutOnly: true, timeoutMs: 30_000 })))(plistPath, options.signal)
    : raw.toString("utf8").trimStart().startsWith("<") || raw.toString("utf8").trimStart().startsWith("{")
      ? raw.toString("utf8")
      : await (options.convertPlist ?? ((path, signal) => runOwnedProcess("plutil", ["-convert", "json", "-o", "-", path], { signal, stdoutOnly: true, timeoutMs: 30_000 })))(plistPath, options.signal);
  return parseInfoPlist(text);
}
