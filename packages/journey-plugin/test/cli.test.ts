import assert from "node:assert/strict";
import test from "node:test";
import { CliUsageError, help, parseCommand, runCommand, usage, usageExitCode, type CliDefinition } from "../src/cli.js";

const cli: CliDefinition = {
  program: "tool",
  commands: {
    run: {
      arguments: ["<file>"], options: { "--out": { value: "<dir>", required: true }, "--port": { value: "<n>", default: "80" }, "--name": { value: "<text>" } }, switches: ["--dry"],
      description: ["Runs the file. This sentence is long enough that the help has to wrap it onto a second line under the command.", "  verbatim   line"],
      exits: { 1: "the file failed" }
    },
    check: { arguments: ["<file>..."], description: ["Checks files."], exits: { 3: "a check was skipped" } },
    "group up": { arguments: [], description: ["Starts."] },
    "group down": { arguments: [], description: ["Stops."] }
  },
  notes: ["A note."],
  exits: { 0: "Success.", 1: "Any command: an unexpected error.", 2: "Invalid arguments." }
};
const usageError = (pattern: RegExp) => (error: unknown) => error instanceof CliUsageError && pattern.test(error.message);

test("usage lines and help derive from the declaration", () => {
  assert.equal(usage(cli, "run"), "tool run <file> --out <dir> [--port <n>] [--name <text>] [--dry]");
  assert.equal(usage(cli, "check"), "tool check <file>...");
  const text = help(cli);
  assert.ok(text.startsWith("Usage:\n  tool run <file> --out <dir> [--port <n>] [--name <text>] [--dry]\n  tool check <file>...\n  tool group up\n  tool group down\n\nCommands:\n"));
  assert.match(text, /^ {2}run {9}Runs the file\. .*\n {14}.*under the command\.\n {14} {2}verbatim {3}line\n {14}Defaults: --port 80\.$/m);
  assert.match(text, /\n\nA note\.\n\nExit codes:\n {2}0 {2}Success\.\n {2}1 {2}run: the file failed\. Any command: an unexpected error\.\n {2}2 {2}Invalid arguments\.\n {2}3 {2}check: a check was skipped\.$/);
  for (const line of text.split("\n").filter((line) => !line.startsWith("  tool "))) assert.ok(line.length <= 92, line);
});

test("parsing applies defaults and enforces what the declaration says", () => {
  const parsed = parseCommand(cli, ["run", "a.txt", "--out", "dist", "--dry"]);
  assert.equal(parsed.name, "run");
  assert.deepEqual(parsed.positionals, ["a.txt"]);
  assert.deepEqual(parsed.options, { "--out": "dist", "--port": "80" });
  assert.deepEqual([...parsed.switches], ["--dry"]);
  assert.deepEqual(parseCommand(cli, ["check", "a", "b", "c"]).positionals, ["a", "b", "c"]);
  assert.equal(parseCommand(cli, ["group", "down"]).name, "group down");
  assert.throws(() => parseCommand(cli, ["nope"]), usageError(/^Unknown command "nope"\. Run tool --help for the commands\.$/));
  assert.throws(() => parseCommand(cli, ["toString"]), usageError(/^Unknown command "toString"/));
  assert.throws(() => parseCommand(cli, ["group"]), usageError(/^Unknown command "group": use "group up" or "group down"\.$/));
  assert.throws(() => parseCommand(cli, ["group", "sideways"]), usageError(/^Unknown command "group sideways"/));
  assert.throws(() => parseCommand(cli, ["run", "--out", "dist"]), usageError(/^Missing arguments for run\.\nUsage: tool run /));
  assert.throws(() => parseCommand(cli, ["run", "a", "b", "--out", "dist"]), usageError(/^Unexpected argument "b" for run\./));
  assert.throws(() => parseCommand(cli, ["run", "a"]), usageError(/^Missing --out <dir> for run\./));
  assert.throws(() => parseCommand(cli, ["run", "a", "--out"]), usageError(/^Missing value for --out\./));
  assert.throws(() => parseCommand(cli, ["run", "a", "--out", "--dry"]), usageError(/^Missing value for --out\./));
  assert.throws(() => parseCommand(cli, ["run", "a", "--out", "d", "--prot", "1"]), usageError(/^Unknown option --prot for run\./));
  assert.throws(() => parseCommand(cli, ["check"]), usageError(/^Missing arguments for check\./));
});

test("runCommand prints help, and exits 2 for argument errors and 1 for failures", async (t) => {
  const printed: string[] = [];
  t.mock.method(console, "log", (text: string) => printed.push(text));
  t.mock.method(console, "error", (text: string) => printed.push(text));
  assert.equal(await runCommand(cli, [], async () => 5), 0);
  assert.equal(await runCommand(cli, ["run", "--help"], async () => 5), 0);
  assert.equal(printed.splice(0).join(""), help(cli) + help(cli));
  assert.equal(await runCommand(cli, ["nope"], async () => 0), usageExitCode);
  assert.equal(await runCommand(cli, ["check", "a"], async () => { throw new Error("broken"); }), 1);
  assert.equal(await runCommand(cli, ["check", "a"], async () => { throw new CliUsageError("not a file"); }), usageExitCode);
  assert.equal(await runCommand(cli, ["check", "a"], async () => 3), 3);
  assert.equal(await runCommand(cli, ["check", "a"], async () => {}), 0);
  assert.deepEqual(printed, ['Unknown command "nope". Run tool --help for the commands.', "broken", "not a file"]);
});
