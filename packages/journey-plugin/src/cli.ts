/**
 * Command-line contracts. A CLI declares its commands once; parsing, defaults, usage lines, help text and
 * argument errors are all derived from that declaration, so what a CLI says and what it accepts cannot drift
 * apart. Third-party tools rely on this output: each CLI commits its `--help` as `contract/<program>.help.txt`.
 */

/** An option that takes a value: its placeholder, whether it must be given, and the default the CLI owns, if any. */
export type CliOption = Readonly<{ value: string; required?: boolean; default?: string }>;

export type CliCommand = Readonly<{
  /** Positional arguments in order. A trailing `...` makes the last one repeatable. */
  arguments: readonly string[];
  options?: Readonly<Record<string, CliOption>>;
  /** Options without a value. */
  switches?: readonly string[];
  /** Help paragraphs. A paragraph that starts with two spaces is printed as is. */
  description: readonly string[];
  /** What an exit code means for this command, in addition to the meanings every command shares. */
  exits?: Readonly<Record<number, string>>;
}>;

export type CliDefinition = Readonly<{
  /** How the CLI is invoked, for example `journey-mesh`. */
  program: string;
  /** Commands by name. A name may have several words, such as `services up`. */
  commands: Readonly<Record<string, CliCommand>>;
  /** Help paragraphs after the commands. A paragraph that starts with two spaces is printed as is. */
  notes?: readonly string[];
  /** Exit codes every command shares. */
  exits: Readonly<Record<number, string>>;
}>;

export type ParsedCommand = Readonly<{
  name: string;
  positionals: readonly string[];
  /** Given option values, with declared defaults for the options not given. */
  options: Readonly<Record<string, string>>;
  switches: ReadonlySet<string>;
}>;

/** A command line the CLI cannot act on. CLIs exit with {@link usageExitCode} for it. */
export class CliUsageError extends Error {}

/** The exit code of a command line the CLI cannot act on, in every CLI. */
export const usageExitCode = 2;

const width = 92;

function wrap(text: string, indent: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (line && indent + line.length + 1 + word.length > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  return line ? [...lines, line] : lines;
}

const paragraphs = (texts: readonly string[], indent: number) => texts.flatMap((text) => text.startsWith("  ") ? [text] : wrap(text, indent));

/** The usage line of one command. */
export function usage(cli: CliDefinition, name: string): string {
  const command = cli.commands[name];
  return [cli.program, name, ...command.arguments,
    ...Object.entries(command.options ?? {}).map(([option, { value, required }]) => required ? `${option} ${value}` : `[${option} ${value}]`),
    ...(command.switches ?? []).map((option) => `[${option}]`)].join(" ");
}

/** The complete help text. */
export function help(cli: CliDefinition): string {
  const names = Object.keys(cli.commands);
  const column = Math.max(...names.map((name) => name.length)) + 2;
  const indent = " ".repeat(2 + column);
  const lines = ["Usage:", ...names.map((name) => `  ${usage(cli, name)}`), "", "Commands:"];
  for (const name of names) {
    const command = cli.commands[name];
    const defaults = Object.entries(command.options ?? {}).filter(([, option]) => option.default !== undefined);
    const text = [...command.description, ...(defaults.length ? [`Defaults: ${defaults.map(([option, { default: value }]) => `${option} ${value}`).join(", ")}.`] : [])];
    lines.push(...paragraphs(text, indent.length).map((line, index) => `${index ? indent : `  ${name.padEnd(column)}`}${line}`));
  }
  if (cli.notes?.length) lines.push("", ...paragraphs(cli.notes, 0));
  const codes = [...new Set([...Object.keys(cli.exits), ...names.flatMap((name) => Object.keys(cli.commands[name].exits ?? {}))].map(Number))].sort((a, b) => a - b);
  lines.push("", "Exit codes:");
  for (const code of codes) {
    const meanings = [...names.filter((name) => cli.commands[name].exits?.[code]).map((name) => `${name}: ${cli.commands[name].exits![code]}.`), ...(cli.exits[code] ? [cli.exits[code]] : [])];
    lines.push(...wrap(meanings.join(" "), 5).map((line, index) => `${index ? "     " : `  ${String(code).padEnd(3)}`}${line}`));
  }
  return lines.join("\n");
}

/** Parse a command line against the declaration. Throws {@link CliUsageError} naming what is wrong. */
export function parseCommand(cli: CliDefinition, args: readonly string[]): ParsedCommand {
  const name = Object.keys(cli.commands)
    .filter((candidate) => candidate.split(" ").every((word, index) => args[index] === word))
    .sort((a, b) => b.length - a.length)[0];
  if (name === undefined) {
    const group = Object.keys(cli.commands).filter((candidate) => candidate.startsWith(`${args[0]} `));
    const given = [args[0], ...(group.length && args[1] && !args[1].startsWith("--") ? [args[1]] : [])].join(" ");
    throw new CliUsageError(group.length
      ? `Unknown command ${JSON.stringify(given)}: use ${group.map((candidate) => JSON.stringify(candidate)).join(" or ")}.`
      : `Unknown command ${JSON.stringify(given)}. Run ${cli.program} --help for the commands.`);
  }
  const command = cli.commands[name];
  const wrong = (message: string) => new CliUsageError(`${message}\nUsage: ${usage(cli, name)}`);
  const declared = command.options ?? {};
  const positionals: string[] = [];
  const options: Record<string, string> = {};
  const switches = new Set<string>();
  for (let index = name.split(" ").length; index < args.length; index++) {
    const value = args[index];
    if (!value.startsWith("--")) { positionals.push(value); continue; }
    if (command.switches?.includes(value)) { switches.add(value); continue; }
    if (!Object.hasOwn(declared, value)) throw wrong(`Unknown option ${value} for ${name}.`);
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) throw wrong(`Missing value for ${value}.`);
    options[value] = next; index++;
  }
  const repeatable = command.arguments.at(-1)?.endsWith("...") ?? false;
  if (positionals.length < command.arguments.length) throw wrong(`Missing arguments for ${name}.`);
  if (!repeatable && positionals.length > command.arguments.length) throw wrong(`Unexpected argument ${JSON.stringify(positionals[command.arguments.length])} for ${name}.`);
  for (const [option, { value, required }] of Object.entries(declared)) if (required && options[option] === undefined) throw wrong(`Missing ${option} ${value} for ${name}.`);
  for (const [option, { default: value }] of Object.entries(declared)) if (value !== undefined && options[option] === undefined) options[option] = value;
  return Object.freeze({ name, positionals: Object.freeze(positionals), options: Object.freeze(options), switches });
}

/**
 * Run a CLI: `--help` or no arguments print the help, argument errors exit with {@link usageExitCode}, and any
 * other error exits 1. `run` returns the exit code, or nothing for 0.
 */
export async function runCommand(cli: CliDefinition, args: readonly string[], run: (command: ParsedCommand) => Promise<number | void>): Promise<number> {
  if (!args.length || args.includes("--help")) { console.log(help(cli)); return 0; }
  try { return (await run(parseCommand(cli, args))) ?? 0; }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return error instanceof CliUsageError ? usageExitCode : 1;
  }
}
