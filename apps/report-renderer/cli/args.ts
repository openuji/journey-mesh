import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `pnpm --filter @openuji/report-renderer <script> <args>` runs scripts in this package's directory;
 * paths resolve against the directory pnpm was started from (INIT_CWD).
 */
export const fromInvocation = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path);

export function parseArgs(args: readonly string[], usage: string): { positionals: string[]; flags: Record<string, string> } {
  const positionals: string[] = []; const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--help") { console.log(usage); process.exit(0); }
    if (!args[index].startsWith("--")) { positionals.push(args[index]); continue; }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${args[index]}\n${usage}`);
    flags[args[index]] = next; index++;
  }
  if (positionals.length !== 1) throw new Error(usage);
  return { positionals, flags };
}

/** Run `main` when the module is the script being executed, reporting errors as exit code 1. */
export function runScript(url: string, main: (args: string[]) => Promise<void>): void {
  if (!process.argv[1] || pathToFileURL(resolve(process.argv[1])).href !== url) return;
  main(process.argv.slice(2)).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
