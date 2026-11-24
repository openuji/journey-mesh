import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { executeSuite, JourneyConfigError, prepareSuite, runConfiguredServices, validateSuite } from "@openuji/journey-host";
import { testFailures } from "@openuji/journey-run-record";
import { runDirectory } from "@openuji/journey-run-record/node";
import { buildReport, compareRuns, defaultReportConfig, exportReport, loadReportConfig, type ComparisonPairing, type ReportConfig } from "@openuji/journey-reporter";
import { consoleJourneyProgress } from "@openuji/journey-runner/console";
import { discover } from "./discover.js";

/**
 * The composition root: the only place that wires execution (host → run record) to reporting
 * (run record → report model). Neither side depends on the other.
 */
const help = `Usage:
  journey-mesh test <config.yaml> [--test <id>] [--output <directory>] [--no-report]
  journey-mesh validate <config.yaml>... [--test <id>]
  journey-mesh discover <config.yaml> [--test <id>] [--profile <id>] [--output <directory>] [--apply] [--rediscover]
  journey-mesh report <run-directory> [--config <config.yaml>]
  journey-mesh export <run-directory> [--output <file.json>] [--data]
  journey-mesh compare <baseline-run> <candidate-run> [--pairings <file.yaml>] [--title <text>] [--config <config.yaml>] [--output <directory>]
  journey-mesh services up <config.yaml> [--service <key>]
  journey-mesh services down <config.yaml> [--service <key>]

test writes a run record, then derives its report model below <output>/report/.
Without --test, every test in the YAML is selected and must pass preflight.
Validating several configurations checks all of them before any is run.
discover is Web only: it runs tests whose journeys all run on an executor with a discovery mode
(the Playwright executor) and reports the keyboard and pointer paths the model does not declare
yet. A test with a journey on any other executor, such as Android, is rejected. --apply declares
the paths through the suite's model plugin, --rediscover also measures declared paths again.
It is an authoring aid; test never discovers.
Without --service, every entry in the YAML's services section is selected.
View a generated report with the workspace renderer:
  pnpm --filter @openuji/report-renderer serve <run-directory>

Exit codes: 0 passed, 1 failed, 2 configuration error, 3 tests passed but the report could not be built.`;

export const exitCodes = Object.freeze({ passed: 0, failed: 1, configuration: 2, report: 3 });

type CommandSpec = { positionals: [number, number]; flags: readonly string[]; switches?: readonly string[] };
const commands: Record<string, CommandSpec> = {
  test: { positionals: [1, 1], flags: ["--test", "--output"], switches: ["--no-report"] },
  validate: { positionals: [1, Infinity], flags: ["--test"] },
  discover: { positionals: [1, 1], flags: ["--test", "--profile", "--output"], switches: ["--apply", "--rediscover"] },
  report: { positionals: [1, 1], flags: ["--config"] },
  export: { positionals: [1, 1], flags: ["--output"], switches: ["--data"] },
  compare: { positionals: [2, 2], flags: ["--pairings", "--title", "--config", "--output"] },
  "services up": { positionals: [1, 1], flags: ["--service"] },
  "services down": { positionals: [1, 1], flags: ["--service"] }
};

function parseArguments(args: readonly string[]) {
  const name = args[0] === "services" ? `services ${args[1] ?? ""}` : args[0];
  const command = commands[name];
  if (!command) throw new JourneyConfigError(help);
  const positionals: string[] = []; const flags: Record<string, string> = {}; const switches = new Set<string>();
  for (let index = name.split(" ").length; index < args.length; index++) {
    const value = args[index];
    if (!value.startsWith("--")) { positionals.push(value); continue; }
    if (command.switches?.includes(value)) { switches.add(value); continue; }
    const next = args[index + 1];
    if (!command.flags.includes(value)) throw new JourneyConfigError(`Unknown option ${value}`);
    if (!next || next.startsWith("--")) throw new JourneyConfigError(`Missing value for ${value}`);
    flags[value] = next; index++;
  }
  if (positionals.length < command.positionals[0] || positionals.length > command.positionals[1]) throw new JourneyConfigError(help);
  return { name, positionals, flags, switches };
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
  try { return await loadReportConfig(path); }
  catch (error) { throw new JourneyConfigError(`Invalid report configuration in ${path}: ${error instanceof Error ? error.message : "unreadable"}`); }
}

async function printLocations(directory: string): Promise<void> {
  const exists = (path: string) => access(path).then(() => true, () => false);
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
  if (!args.length || args.includes("--help")) { console.log(help); return exitCodes.passed; }
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Journey test interrupted"));
  let parsed: ReturnType<typeof parseArguments> | undefined;
  try {
    parsed = parseArguments(args);
    const { name, positionals, flags, switches } = parsed;
    const [path] = positionals;
    if (name === "services up" || name === "services down") {
      process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
      await runConfiguredServices(path, name === "services up" ? "up" : "down", { service: flags["--service"], signal: controller.signal });
      return exitCodes.passed;
    }
    if (name === "report") {
      const directory = await runDirectory(path);
      const ok = await report(directory, await reportConfig(flags["--config"]));
      await printLocations(directory);
      return ok ? exitCodes.passed : exitCodes.report;
    }
    if (name === "export") {
      const exported = JSON.stringify(await exportReport(path, { data: switches.has("--data") }));
      if (flags["--output"]) await writeFile(resolve(flags["--output"]), exported);
      else process.stdout.write(`${exported}\n`);
      return exitCodes.passed;
    }
    if (name === "compare") {
      const outputDir = resolve(flags["--output"] ?? "comparison-results");
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
    if (error instanceof JourneyConfigError) {
      console.error(error.testId ? `Configuration error in test ${JSON.stringify(error.testId)}:` : "Configuration error:");
      console.error(error.message);
      const alternative = error.testIds.find((id) => id !== error.testId);
      if (parsed && !parsed.flags["--test"] && error.testId && alternative) {
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
