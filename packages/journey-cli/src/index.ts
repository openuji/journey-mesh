import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { executeSuite, JourneyConfigError, prepareSuite, runConfiguredServices, validateSuite } from "@openuji/journey-host";
import { testFailures } from "@openuji/journey-run-record";
import { runDirectory } from "@openuji/journey-run-record/node";
import { buildReport, compareRuns, defaultReportConfig, exportReport, loadReportConfig, type ComparisonPairing, type ReportConfig } from "@openuji/journey-reporter";
import { consoleJourneyProgress } from "@openuji/journey-runner/console";
import { CliUsageError, help, parseCommand, usageExitCode, type CliDefinition, type ParsedCommand } from "@openuji/journey-plugin/cli";
import { discover } from "./discover.js";

/**
 * The composition root: the only place that wires execution (host → run record) to reporting
 * (run record → report model). Neither side depends on the other.
 *
 * `cli` is the command-line contract third-party tools rely on: parsing and help derive from it, and its help is
 * committed as contract/journey-mesh.help.txt.
 */
export const cli: CliDefinition = {
  program: "journey-mesh",
  commands: {
    test: {
      arguments: ["<config.yaml>"], options: { "--test": { value: "<id>" }, "--output": { value: "<directory>" } }, switches: ["--no-report"],
      description: ["Run the tests and write a run record to --output (default: the YAML's outputDir, else test-results next to it), then build its report model below <output>/report/ from the YAML's report: section (skip with --no-report). Without --test, every test is selected, and all must pass preflight before any starts. Prints PASS <id> or FAIL <id> per test, then Run record: <path> and, with a report, Report model: <path>."],
      exits: { 1: "a test failed", 3: "the tests passed, but the report could not be built" }
    },
    validate: {
      arguments: ["<config.yaml>..."], options: { "--test": { value: "<id>" } },
      description: ["Preflight configurations without starting services or running anything. Takes several, for example both sides of a comparison. Prints Valid tests: <ids>."]
    },
    discover: {
      arguments: ["<config.yaml>"], options: { "--test": { value: "<id>" }, "--profile": { value: "<id>" }, "--output": { value: "<directory>" } }, switches: ["--apply", "--rediscover"],
      description: ["Find the keyboard and pointer paths the model does not declare yet, and write them to materializations.json in --output (default: discover/ in the suite's output directory). Web only: a test with a journey on any other executor, such as Android, is rejected. --apply declares the found paths through the suite's model plugin, and --rediscover measures declared paths again. A canonical materialization is performed as declared and never replaced; where it fails before sending input, the path beside it is found. An authoring aid; test never discovers."],
      exits: { 1: "a test failed, a path was not found, profiles found different paths, or preflight still fails after --apply" }
    },
    report: {
      arguments: ["<run-directory>"], options: { "--config": { value: "<config.yaml>" } },
      description: ["Rebuild <run-directory>/report/ from the run record; runs nothing. --config selects the report: section to apply. Without it, no interpreters run, so observer data such as axe results is left out. Prints Run record: <path> and Report model: <path>."],
      exits: { 3: "the report could not be built" }
    },
    export: {
      arguments: ["<run-directory>"], options: { "--output": { value: "<file.json>" } }, switches: ["--data"],
      description: ["Print the report as one JSON value with test models and views inlined, or write it to --output and print Exported report: <path>. --data also inlines every interpreter output."]
    },
    compare: {
      arguments: ["<baseline-run>", "<candidate-run>"],
      options: { "--pairings": { value: "<file.yaml>" }, "--title": { value: "<text>" }, "--config": { value: "<config.yaml>" }, "--output": { value: "<directory>", default: "comparison-results" } },
      description: [
        "Copy two run directories below --output and pair their executions by test and profile ID; runs nothing. A subject keeps its own report; --config builds a missing one. Prints PASS or FAIL per subject, then Comparison: <path>. --pairings pairs different IDs with a YAML list of:",
        "  - { id: <id>, baseline: { test: <id>, profile: <id> },",
        "      candidate: { test: <id>, profile: <id> } }"
      ],
      exits: { 1: "a subject did not pass" }
    },
    "services up": {
      arguments: ["<config.yaml>"], options: { "--service": { value: "<key>" } },
      description: ["Start configured services and their dependencies outside a test run, and leave them running. Without --service, every service in the YAML is selected."]
    },
    "services down": {
      arguments: ["<config.yaml>"], options: { "--service": { value: "<key>" } },
      description: ["Stop services started with services up, and their dependencies. Without --service, every service in the YAML is selected."]
    }
  },
  notes: ["View a report or comparison with the workspace renderer:", "  pnpm --filter @openuji/report-renderer serve <run-directory>"],
  exits: { 0: "Success.", 1: "Any command: an unexpected error.", 2: "Invalid arguments or configuration." }
};

export const exitCodes = Object.freeze({ passed: 0, failed: 1, configuration: usageExitCode, report: 3 });

const exists = (path: string) => access(path).then(() => true, () => false);

/** The run directory an argument names: the directory itself or its run.json. */
async function recordDirectory(path: string): Promise<string> {
  const directory = await runDirectory(path).catch(() => undefined);
  if (!directory || !await exists(resolve(directory, "run.json"))) throw new CliUsageError(`Not a run directory: ${path} (no run.json)`);
  return directory;
}

/** A run or comparison directory with a built report. */
async function reportDirectory(path: string): Promise<string> {
  if (await exists(resolve(path, "report/report.json"))) return path;
  throw new CliUsageError(await exists(resolve(path, "run.json"))
    ? `${path} has no report yet. Build it with:\n  journey-mesh report ${shellArgument(path)} --config <config.yaml>`
    : `Not a run or comparison directory: ${path} (no report/report.json)`);
}

async function readPairings(path: string): Promise<readonly ComparisonPairing[]> {
  let pairings: unknown;
  try { pairings = parse(await readFile(path, "utf8")); }
  catch (error) { throw new JourneyConfigError(`Could not read pairings ${path}: ${error instanceof Error ? error.message : "invalid file"}`); }
  if (!Array.isArray(pairings)) throw new JourneyConfigError("Pairings must be a list of { id, baseline: { test, profile }, candidate: { test, profile } }");
  return pairings as ComparisonPairing[];
}

async function reportConfig(path: string | undefined): Promise<ReportConfig> {
  if (!path) return defaultReportConfig;
  if (!await exists(path)) throw new CliUsageError(`No such configuration file: ${path}`);
  try { return await loadReportConfig(path); }
  catch (error) { throw new JourneyConfigError(`Invalid report configuration in ${path}: ${error instanceof Error ? error.message : "unreadable"}`); }
}

async function printLocations(directory: string): Promise<void> {
  if (await exists(resolve(directory, "run.json"))) console.log(`Run record: ${resolve(directory, "run.json")}`);
  if (await exists(resolve(directory, "report/report.json"))) {
    console.log(`Report model: ${resolve(directory, "report/report.json")}`);
    printViewerCommand(directory);
  }
}

function printViewerCommand(directory: string): void {
  console.log(`View with the workspace renderer:\n  pnpm --filter @openuji/report-renderer serve ${shellArgument(resolve(directory))}`);
}

/** Build the report of a finished run. Report problems are warnings; they never change the run's verdict. */
async function report(directory: string, config: ReportConfig): Promise<boolean> {
  try {
    const { model } = await buildReport(directory, { config });
    for (const error of model.errors) console.error(`  Report warning${error.test ? ` (${error.test})` : ""}: ${error.message}`);
    return true;
  } catch (error) {
    console.error(`Report could not be built: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function main(args: string[]): Promise<number> {
  if (!args.length || args.includes("--help")) { console.log(help(cli)); return exitCodes.passed; }
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Journey test interrupted"));
  let parsed: ParsedCommand | undefined;
  try {
    parsed = parseCommand(cli, args);
    const { name, positionals, options: flags, switches } = parsed;
    const [path] = positionals;
    if (name === "services up" || name === "services down") {
      process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
      await runConfiguredServices(path, name === "services up" ? "up" : "down", { service: flags["--service"], signal: controller.signal });
      return exitCodes.passed;
    }
    if (name === "report") {
      const directory = await recordDirectory(path);
      const ok = await report(directory, await reportConfig(flags["--config"]));
      await printLocations(directory);
      return ok ? exitCodes.passed : exitCodes.report;
    }
    if (name === "export") {
      const exported = JSON.stringify(await exportReport(await reportDirectory(path), { data: switches.has("--data") }));
      if (flags["--output"]) {
        await writeFile(resolve(flags["--output"]), exported);
        console.log(`Exported report: ${resolve(flags["--output"])}`);
      } else process.stdout.write(`${exported}\n`);
      return exitCodes.passed;
    }
    if (name === "compare") {
      const outputDir = resolve(flags["--output"]);
      const config = await reportConfig(flags["--config"]);
      const comparison = await compareRuns({
        baseline: positionals[0], candidate: positionals[1], outputDir, ...(flags["--title"] ? { title: flags["--title"] } : {}), config,
        ...(flags["--pairings"] ? { pairings: await readPairings(flags["--pairings"]) } : {})
      });
      for (const side of ["baseline", "candidate"] as const) {
        const subject = comparison.comparison!.subjects[side];
        console.log(`${subject.ok ? "PASS" : "FAIL"} ${side}${subject.label ? ` (${subject.label})` : ""}`);
        for (const error of subject.errors) console.error(`  ${error.message}`);
      }
      console.log(`Comparison: ${resolve(outputDir, "report/report.json")}`);
      printViewerCommand(outputDir);
      return comparison.ok ? exitCodes.passed : exitCodes.failed;
    }
    process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
    if (name === "discover") {
      return await discover(path, { test: flags["--test"], profile: flags["--profile"], outputDir: flags["--output"], apply: switches.has("--apply"), rediscover: switches.has("--rediscover"), signal: controller.signal });
    }
    if (name === "validate") {
      const valid: string[] = [];
      for (const config of positionals) {
        await reportConfig(config);
        const result = await validateSuite(config, { test: flags["--test"], signal: controller.signal });
        valid.push(...result.tests.map((id) => positionals.length > 1 ? `${config}#${id}` : id));
      }
      console.log(`Valid tests: ${valid.join(", ")}`); return exitCodes.passed;
    }
    const config = await reportConfig(path);
    const options = { test: flags["--test"], outputDir: flags["--output"] ? resolve(flags["--output"]) : undefined, signal: controller.signal };
    const prepared = await prepareSuite(path, options);
    const run = await executeSuite(prepared, { ...options, progress: [
      consoleJourneyProgress(),
      { publish(event) {
        if (event.type === "execution-completed") console.log(`  ${event.result.profileId}: ${event.result.outcome.kind}`);
      } }
    ] });
    for (const test of run.tests) {
      console.log(`${test.ok ? "PASS" : "FAIL"} ${test.id}`);
      for (const error of testFailures(test)) console.error(`  ${error.name}: ${error.message}`);
    }
    for (const error of run.errors) console.error(`  ${error.name}: ${error.message}`);
    const reported = switches.has("--no-report") || await report(prepared.outputDir, config);
    await printLocations(prepared.outputDir);
    return !run.ok ? exitCodes.failed : reported ? exitCodes.passed : exitCodes.report;
  } catch (error) {
    if (error instanceof CliUsageError) { console.error(error.message); return exitCodes.configuration; }
    if (error instanceof JourneyConfigError) {
      console.error(error.testId ? `Configuration error in test ${JSON.stringify(error.testId)}:` : "Configuration error:");
      console.error(error.message);
      const alternative = error.testIds.find((id) => id !== error.testId);
      if (parsed && !parsed.options["--test"] && error.testId && alternative) {
        console.error("Without --test, all configured tests must pass preflight. No tests were started.");
        console.error(`To select ${JSON.stringify(alternative)} only:\n  journey-mesh ${parsed.name} ${shellArgument(parsed.positionals[0])} --test ${shellArgument(alternative)}`);
      }
      return exitCodes.configuration;
    }
    console.error(error instanceof Error ? error.message : "Journey Mesh failed");
    return exitCodes.failed;
  } finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  }
}

function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:@-]+$/.test(value) ? value : "'" + value.split("'").join(`'"'"'`) + "'";
}
