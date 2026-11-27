import { appendFile } from "node:fs/promises";
import { loadSuiteConfig, interpolate } from "@openuji/journey-host";
import { parseIosTarget, validateIosTarget } from "@openuji/journey-toolkit-ios";
import { runCommand, type CliDefinition } from "@openuji/journey-plugin/cli";

/** The command-line contract; its help is committed as contract/journey-service-ios.help.txt. */
export const cli: CliDefinition = {
  program: "journey-service-ios",
  commands: {
    "ios check": {
      arguments: ["<config.yaml>"], options: { "--service": { value: "<key>", default: "ios" }, "--require-locale": { value: "<locale>" } }, switches: ["--github-output"],
      description: [
        "Check that the iOS Simulator target in services.<key>.options has a runtime and device type that agree. Prints a confirmation line.",
        "--require-locale also requires the target's locale pin to equal <locale>, for a caller whose models depend on it; no locale is assumed without it.",
        "--github-output writes simulator, device-type and runtime to GITHUB_OUTPUT, for a step that selects or caches the simulator runtime."
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
    const target = parseIosTarget(targetOptions);
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
  });
}
