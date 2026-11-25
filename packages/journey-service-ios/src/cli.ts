import { appendFile } from "node:fs/promises";
import { loadSuiteConfig, interpolate } from "@openuji/journey-host";
import { parseIosTarget, validateIosTarget } from "@openuji/journey-toolkit-ios";

const help = `Usage:
  journey-service-ios ios check <config.yaml> [--service <key>] [--require-locale <locale>] [--github-output]

Loads <config.yaml>'s services.<key> options (default "ios"), parses and
validates the iOS simulator target (runtime/deviceType agreement). --require-locale
asserts the target's own locale pin matches exactly. --github-output writes
simulator/device-type/runtime as GITHUB_OUTPUT entries.`;

function parseFlags(args: readonly string[]): { service: string; requireLocale?: string; githubOutput: boolean } {
  let service = "ios";
  let requireLocale: string | undefined;
  let githubOutput = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--github-output") { githubOutput = true; continue; }
    if (argument === "--service" || argument === "--require-locale") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      if (argument === "--service") service = value; else requireLocale = value;
      continue;
    }
    throw new Error(`Unknown option ${argument}`);
  }
  return { service, requireLocale, githubOutput };
}

export async function main(args: readonly string[]): Promise<number> {
  if (!args.length || args.includes("--help")) { console.log(help); return 0; }
  const [group, action, path, ...flags] = args;
  try {
    if (group !== "ios" || action !== "check" || !path) throw new Error(help);
    const { service, requireLocale, githubOutput } = parseFlags(flags);
    const loaded = await loadSuiteConfig(path);
    const rawOptions = loaded.config.services[service]?.options;
    if (!rawOptions) throw new Error(`${path} is missing services.${service}.options`);
    const options = interpolate(rawOptions, loaded.env, `services.${service}.options`);
    const target = parseIosTarget(options);
    validateIosTarget(target);
    if (requireLocale !== undefined && target.locale !== requireLocale) {
      throw new Error(`services.${service}.options.locale is ${target.locale ?? "unset"}; expected ${requireLocale}`);
    }
    if (githubOutput) {
      if (!process.env.GITHUB_OUTPUT) throw new Error("--github-output requires GITHUB_OUTPUT");
      await appendFile(process.env.GITHUB_OUTPUT, [
        `simulator=${target.simulator}`, `device-type=${target.deviceType}`, `runtime=${target.runtime}`, ""
      ].join("\n"));
    }
    console.log(`iOS simulator target's runtime and deviceType agree (services.${service}).`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "journey-service-ios failed");
    return 1;
  }
}
