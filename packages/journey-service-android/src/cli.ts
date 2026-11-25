import { appendFile } from "node:fs/promises";
import { loadSuiteConfig, interpolate } from "@openuji/journey-host";
import { parseAndroidTarget, validateAndroidTarget } from "@openuji/journey-toolkit-android";
import { runCommand, type CliDefinition } from "@openuji/journey-plugin/cli";

/** The command-line contract; its help is committed as contract/journey-service-android.help.txt. */
export const cli: CliDefinition = {
  program: "journey-service-android",
  commands: {
    "android check": {
      arguments: ["<config.yaml>"], options: { "--service": { value: "<key>", default: "android" }, "--require-locale": { value: "<locale>" } }, switches: ["--github-output"],
      description: [
        "Check that the Android target in services.<key>.options has an API level and system image that agree. Prints a confirmation line.",
        "--require-locale also requires the target's locale pin to equal <locale>, for a caller whose models depend on it; no locale is assumed without it.",
        "--github-output writes api-level, target, arch and profile to GITHUB_OUTPUT, for a step that configures android-emulator-runner."
      ]
    }
  },
  exits: { 0: "Success.", 1: "The configuration failed the check.", 2: "Invalid arguments." }
};

export async function main(args: readonly string[]): Promise<number> {
  return runCommand(cli, args, async ({ positionals: [path], options, switches }) => {
    const service = options["--service"], requireLocale = options["--require-locale"], githubOutput = switches.has("--github-output");
    const loaded = await loadSuiteConfig(path);
    const rawOptions = loaded.config.services[service]?.options;
    if (!rawOptions) throw new Error(`${path} is missing services.${service}.options`);
    const targetOptions = interpolate(rawOptions, loaded.env, `services.${service}.options`);
    const target = parseAndroidTarget(targetOptions);
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
  });
}
