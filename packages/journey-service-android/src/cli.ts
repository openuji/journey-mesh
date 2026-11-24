import { appendFile } from "node:fs/promises";
import { loadSuiteConfig, interpolate } from "@openuji/journey-host";
import { parseAndroidTarget, validateAndroidTarget } from "@openuji/journey-toolkit-android";

const help = `Usage:
  journey-service-android android check <config.yaml> [--service <key>] [--require-locale <locale>] [--github-output]

Loads <config.yaml>'s services.<key> options (default "android"), parses and
validates the Android target (API/system-image agreement). --require-locale
asserts the target's own locale pin matches exactly — a caller's business
rule (e.g. "this example's checked-in native bindings require en-US"), not a
generic Android constraint, so it is never assumed without this flag.
--github-output writes api-level/target/arch/profile as GITHUB_OUTPUT entries
for a step that configures android-emulator-runner.`;

function parseFlags(args: readonly string[]): { service: string; requireLocale?: string; githubOutput: boolean } {
  let service = "android";
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
    if (group !== "android" || action !== "check" || !path) throw new Error(help);
    const { service, requireLocale, githubOutput } = parseFlags(flags);
    const loaded = await loadSuiteConfig(path);
    const rawOptions = loaded.config.services[service]?.options;
    if (!rawOptions) throw new Error(`${path} is missing services.${service}.options`);
    const options = interpolate(rawOptions, loaded.env, `services.${service}.options`);
    const target = parseAndroidTarget(options);
    validateAndroidTarget(target);
    if (requireLocale !== undefined && target.locale !== requireLocale) {
      throw new Error(`services.${service}.options.locale is ${target.locale ?? "unset"}; expected ${requireLocale}`);
    }
    if (githubOutput) {
      if (!process.env.GITHUB_OUTPUT) throw new Error("--github-output requires GITHUB_OUTPUT");
      const [, , imageTarget, arch] = target.image.split(";");
      await appendFile(process.env.GITHUB_OUTPUT, [
        `api-level=${target.api}`, `target=${imageTarget}`, `arch=${arch}`, `profile=${target.profile}`, ""
      ].join("\n"));
    }
    console.log(`Android target's API level and system image agree (services.${service}).`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "journey-service-android failed");
    return 1;
  }
}
