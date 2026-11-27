import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { runOwnedProcess } from "@openuji/journey-plugin/node";

export type XcodeBuildToolchain = Readonly<{
  developerDir: string;
  xcodeVersion: string;
  xcodeBuild: string;
  swiftVersion: string;
  fingerprint: string;
}>;

export type XcodeBuildRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; logPath: string; signal?: AbortSignal }
) => Promise<void>;

/** Run a short host tool and return its stdout; bounded so a hung tool cannot stall a build. */
export const captureIosTool = (
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env
) => runOwnedProcess(command, args, { env, signal, stdoutOnly: true, timeoutMs: 30_000 });

export function parseXcodeVersionOutput(output: string): { xcodeVersion: string; xcodeBuild: string } {
  const version = /^Xcode\s+(\S+)/m.exec(output)?.[1];
  const build = /^Build version\s+(\S+)/m.exec(output)?.[1];
  if (!version || !build) throw new Error("Cannot parse Xcode version and build from `xcodebuild -version`");
  return { xcodeVersion: version, xcodeBuild: build };
}

/** Resolve active Xcode developer directory, Xcode/Swift versions, and a deterministic tool fingerprint. */
export async function hostXcodeToolchain(
  expectedXcodeVersion?: string,
  environment: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
  runTool: (command: string, args: readonly string[], signal?: AbortSignal) => Promise<string> = (cmd, args, sig) => captureIosTool(cmd, args, sig, environment)
): Promise<XcodeBuildToolchain> {
  const developerDir = (environment.DEVELOPER_DIR?.trim() || await runTool("xcode-select", ["-p"], signal)).trim();
  if (!developerDir) throw new Error("Xcode developer directory was not found; install Xcode and configure xcode-select");
  const versionOutput = await runTool("xcodebuild", ["-version"], signal);
  const { xcodeVersion, xcodeBuild } = parseXcodeVersionOutput(versionOutput);
  if (expectedXcodeVersion !== undefined && xcodeVersion !== expectedXcodeVersion && !xcodeVersion.startsWith(`${expectedXcodeVersion}.`)) {
    throw new Error(`Active Xcode is ${xcodeVersion}; this build requires Xcode ${expectedXcodeVersion}`);
  }
  const swiftVersion = (await runTool("xcrun", ["swift", "--version"], signal)).split(/\r?\n/)[0]?.trim() ?? "";
  if (!swiftVersion) throw new Error("Cannot determine Swift toolchain version from `xcrun swift --version`");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ developerDir, xcodeVersion, xcodeBuild, swiftVersion }))
    .digest("hex");
  return Object.freeze({ developerDir, xcodeVersion, xcodeBuild, swiftVersion, fingerprint });
}

/** `xcodebuild` output goes to `logPath`; the whole process group stops on abort. */
export const runXcodebuild: XcodeBuildRunner = async (command, args, { cwd, env, logPath, signal }) => {
  await writeFile(logPath, "", { mode: 0o600 });
  let writes = Promise.resolve();
  try {
    await runOwnedProcess(command, args, {
      cwd,
      env,
      signal,
      onOutput: (text) => { writes = writes.then(() => appendFile(logPath, text)); }
    });
  } finally {
    await writes;
  }
};

export async function iosFileSha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
