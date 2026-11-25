import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CliUsageError, runCommand, type CliDefinition, type ParsedCommand } from "@openuji/journey-plugin/cli";
import { defaultMaxFileBytes } from "./json-document.js";

/** The command-line contract of the renderer's scripts; its help is committed as contract/report-renderer.help.txt. */
export const cli: CliDefinition = {
  program: "pnpm --filter @openuji/report-renderer",
  commands: {
    serve: {
      arguments: ["<run-directory>"], options: { "--port": { value: "<number>", default: "9323" } },
      description: ["Serve the interactive viewer for a run or comparison directory on 127.0.0.1, reading its existing report; runs nothing. Prints Journey Mesh report: <url>."]
    },
    site: {
      arguments: ["<run-directory>"], options: { "--out": { value: "<directory>", required: true }, "--max-file-size-mib": { value: "<number>", default: String(defaultMaxFileBytes / 1024 / 1024) } },
      description: ["Publish a run or comparison directory with the viewer as a static site in --out. A JSON file larger than --max-file-size-mib is split into linked parts; any other file over the limit fails. Prints Site: <path>."]
    },
    markdown: {
      arguments: ["<run-directory>"], options: { "--output": { value: "<file.md>" } },
      description: ["Print a Markdown summary of the report, for a CI job summary or a pull request comment, or write it to --output and print Markdown: <path>."]
    }
  },
  notes: ["<run-directory> resolves against the directory pnpm was started from, and must contain report/report.json; build one with journey-mesh report."],
  exits: { 0: "Success.", 1: "The command failed.", 2: "Invalid arguments, or <run-directory> has no report." }
};

/**
 * `pnpm --filter @openuji/report-renderer <script> <args>` runs scripts in this package's directory;
 * paths resolve against the directory pnpm was started from (INIT_CWD).
 */
export const fromInvocation = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path);

/** A run or comparison directory, resolved from the invocation, that has a built report. */
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
