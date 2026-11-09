import { appendFile } from "node:fs/promises";
import { loadJourneyTestConfig, interpolate } from "@openuji/journey-runtime";
import { parseAndroidTarget, validateAndroidTarget } from "./android.js";

const help = `Usage:
  journey-driver-android android check <config.yaml> [--runtime <key>] [--require-locale <locale>] [--github-output]

Loads <config.yaml>'s runtimes.<key> options (default "android"), parses and
validates the Android target (API/system-image agreement). --require-locale
asserts the target's own locale pin matches exactly — a caller's business
rule (e.g. "this example's checked-in native bindings require en-US"), not a
generic Android-runtime constraint, so it is never assumed without this flag.
--github-output writes api-level/target/arch/profile as GITHUB_OUTPUT entries
for a step that configures android-emulator-runner.`;

function parseFlags(args: readonly string[]): { runtime: string; requireLocale?: string; githubOutput: boolean } {
  let runtime = "android";
  let requireLocale: string | undefined;
  let githubOutput = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--github-output") { githubOutput = true; continue; }
    if (argument === "--runtime" || argument === "--require-locale") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      if (argument === "--runtime") runtime = value; else requireLocale = value;
      continue;
    }
    throw new Error(`Unknown option ${argument}`);
  }
  return { runtime, requireLocale, githubOutput };
}

export async function main(args: readonly string[]): Promise<number> {
  if (!args.length || args.includes("--help")) { console.log(help); return 0; }
  const [group, action, path, ...flags] = args;
  try {
    if (group !== "android" || action !== "check" || !path) throw new Error(help);
    const { runtime, requireLocale, githubOutput } = parseFlags(flags);
    const loaded = await loadJourneyTestConfig(path);
    const rawOptions = loaded.config.runtimes?.[runtime]?.options;
    if (!rawOptions) throw new Error(`${path} is missing runtimes.${runtime}.options`);
    const options = interpolate(rawOptions, loaded.env, `runtimes.${runtime}.options`);
    const target = parseAndroidTarget(options);
    validateAndroidTarget(target);
    if (requireLocale !== undefined && target.locale !== requireLocale) {
      throw new Error(`runtimes.${runtime}.options.locale is ${target.locale ?? "unset"}; expected ${requireLocale}`);
    }
    if (githubOutput) {
      if (!process.env.GITHUB_OUTPUT) throw new Error("--github-output requires GITHUB_OUTPUT");
      const [, , imageTarget, arch] = target.image.split(";");
      await appendFile(process.env.GITHUB_OUTPUT, [
        `api-level=${target.api}`, `target=${imageTarget}`, `arch=${arch}`, `profile=${target.profile}`, ""
      ].join("\n"));
    }
    console.log(`Android target's API level and system image agree (runtimes.${runtime}).`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "journey-driver-android failed");
    return 1;
  }
}
