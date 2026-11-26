import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CliUsageError, runCommand, type CliDefinition, type ParsedCommand } from "@openuji/journey-plugin/cli";

/** The command-line contract of the finding reporter; its help is committed as contract/finding-reporter.help.txt. */
export const cli: CliDefinition = {
  program: "pnpm --filter @openuji/finding-reporter",
  commands: {
    bundle: {
      arguments: ["<run-directory>"],
      options: {
        "--out": { value: "<directory>", required: true },
        "--finding": { value: "<id>" },
        "--image-base-url": { value: "<url>" }
      },
      description: [
        "Write a GitHub-ready bundle for every finding of the run, in <out>/<id>/: issue.md, annotated.png (the screenshots with the problem in red and the expected state in green), the raw screenshots, and evidence.json. A finding is an operation that failed against what the model declares, such as a focus move that did not reach its object. <out>/index.md lists every finding. Runs nothing. Prints Finding: <id> <issue.md> for each bundle, then Findings: <index.md>.",
        "--finding writes the bundle of one finding. --image-base-url makes the image links in issue.md absolute, for issues whose images are hosted elsewhere."
      ]
    }
  },
  notes: [
    "<run-directory> resolves against the directory pnpm was started from. Its report must be built with @openuji/journey-report-findings in report.interpreters, from a run with @openuji/journey-observer-findings. Drawing needs Chromium (npx playwright install chromium)."
  ],
  exits: {
    0: "Success, also when the run has no findings.",
    1: "The command failed.",
    2: "Invalid arguments, an unknown --finding, or a run directory without a report or without findings data."
  }
};

/**
 * `pnpm --filter @openuji/finding-reporter <script> <args>` runs in this package's directory; paths
 * resolve against the directory pnpm was started from (INIT_CWD).
 */
export const fromInvocation = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path);

/** A run directory, resolved from the invocation, that has a built report. */
export async function reportDirectory(path: string): Promise<string> {
  const directory = fromInvocation(path);
  try { await access(resolve(directory, "report/report.json")); }
  catch { throw new CliUsageError(`No report model in ${path} (no report/report.json). Build it with journey-mesh report.`); }
  return directory;
}

/** Run one of the declared commands when the module is the script being executed. */
export function runScript(url: string, name: string, run: (command: ParsedCommand) => Promise<void>): void {
  if (!process.argv[1] || pathToFileURL(resolve(process.argv[1])).href !== url) return;
  void runCommand(cli, [name, ...process.argv.slice(2)], run).then((code) => { process.exitCode = code; });
}
