import { createServer, type Server } from "node:http";
import { access, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import { executeSuite, JourneyConfigError, prepareSuite, runConfiguredServices, validateSuite } from "@openuji/journey-host";
import { compareBundles, publishReport, testFailures, testPassed } from "@openuji/journey-reporter";
import type { ComparisonPairing } from "@openuji/journey-plugin";
import { consoleJourneyProgress } from "@openuji/journey-runner/console";

const help = `Usage:
  journey-mesh test <config.yaml> [--test <id>] [--output <directory>]
  journey-mesh validate <config.yaml>... [--test <id>]
  journey-mesh compare <baseline/bundle.json> <candidate/bundle.json> [--pairings <file.yaml>] [--title <text>] [--output <directory>]
  journey-mesh render <bundle.json> [--output <directory>]
  journey-mesh services up <config.yaml> [--service <key>]
  journey-mesh services down <config.yaml> [--service <key>]
  journey-mesh report <directory> [--port <number>]

Without --test, every test in the YAML is selected and must pass preflight.
Validating several configurations checks all of them before any is run.
Without --service, every entry in the YAML's services section is selected.`;

const commands: Record<string, { positionals: [number, number]; flags: readonly string[] }> = {
  test: { positionals: [1, 1], flags: ["--test", "--output"] },
  validate: { positionals: [1, Infinity], flags: ["--test"] },
  compare: { positionals: [2, 2], flags: ["--pairings", "--title", "--output"] },
  render: { positionals: [1, 1], flags: ["--output"] },
  report: { positionals: [1, 1], flags: ["--port"] },
  "services up": { positionals: [1, 1], flags: ["--service"] },
  "services down": { positionals: [1, 1], flags: ["--service"] }
};

function parseArguments(args: readonly string[]) {
  const name = args[0] === "services" ? `services ${args[1] ?? ""}` : args[0];
  const command = commands[name];
  if (!command) throw new JourneyConfigError(help);
  const positionals: string[] = []; const flags: Record<string, string> = {};
  for (let index = name.split(" ").length; index < args.length; index++) {
    const value = args[index];
    if (!value.startsWith("--")) { positionals.push(value); continue; }
    const next = args[index + 1];
    if (!command.flags.includes(value)) throw new JourneyConfigError(`Unknown option ${value}`);
    if (!next || next.startsWith("--")) throw new JourneyConfigError(`Missing value for ${value}`);
    flags[value] = next; index++;
  }
  if (positionals.length < command.positionals[0] || positionals.length > command.positionals[1]) throw new JourneyConfigError(help);
  if (flags["--port"] !== undefined && (!/^\d+$/.test(flags["--port"]) || Number(flags["--port"]) > 65535)) throw new JourneyConfigError("--port must be a TCP port");
  return { name, positionals, flags };
}

async function readPairings(path: string): Promise<readonly ComparisonPairing[]> {
  let pairings: unknown;
  try { pairings = parse(await readFile(path, "utf8")); }
  catch (error) { throw new JourneyConfigError(`Could not read pairings ${path}: ${error instanceof Error ? error.message : "invalid file"}`); }
  if (!Array.isArray(pairings)) throw new JourneyConfigError("Pairings must be a list of { id, baseline: { test, profile }, candidate: { test, profile } }");
  return pairings as ComparisonPairing[];
}

async function printReportLocation(directory: string): Promise<void> {
  const index = resolve(directory, "index.html");
  if (await access(index).then(() => true, () => false)) console.log(`Report: ${index}`);
}

export async function main(args: string[]): Promise<number> {
  if (!args.length || args.includes("--help")) { console.log(help); return 0; }
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Journey test interrupted"));
  let parsed: ReturnType<typeof parseArguments> | undefined;
  try {
    parsed = parseArguments(args);
    const { name, positionals, flags } = parsed;
    const [path] = positionals;
    if (name === "services up" || name === "services down") {
      // No SIGINT/SIGTERM handler: androidUp/appiumUp (and any other service
      // plugin) do not check an abort signal mid-operation, so installing one
      // here would only replace Node's default terminate-on-signal behavior
      // with a no-op, making Ctrl-C appear to hang instead of exiting.
      await runConfiguredServices(path, name === "services up" ? "up" : "down", { service: flags["--service"] });
      return 0;
    }
    if (name === "report") { await serveReport(path, flags["--port"] === undefined ? 9323 : Number(flags["--port"])); return 0; }
    if (name === "render") {
      const output = flags["--output"] ? resolve(flags["--output"]) : resolve(path, "..");
      await publishReport(path, output); await printReportLocation(output); return 0;
    }
    if (name === "compare") {
      const outputDir = resolve(flags["--output"] ?? "comparison-results");
      const comparison = await compareBundles({
        baseline: positionals[0], candidate: positionals[1], title: flags["--title"], outputDir,
        ...(flags["--pairings"] ? { pairings: await readPairings(flags["--pairings"]) } : {})
      });
      for (const side of ["baseline", "candidate"] as const) {
        const subject = comparison.subjects[side];
        console.log(`${subject.bundle?.ok && !subject.errors.length ? "PASS" : "FAIL"} ${side}${subject.label ? ` (${subject.label})` : ""}`);
        for (const error of [...subject.errors, ...(subject.bundle?.errors ?? []), ...(subject.bundle?.tests.flatMap(testFailures) ?? [])]) console.error(`  ${error.message}`);
      }
      await printReportLocation(outputDir); return comparison.ok ? 0 : 1;
    }
    process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
    if (name === "validate") {
      const valid: string[] = [];
      for (const config of positionals) {
        const result = await validateSuite(config, { test: flags["--test"], signal: controller.signal });
        valid.push(...result.tests.map((id) => positionals.length > 1 ? `${config}#${id}` : id));
      }
      console.log(`Valid tests: ${valid.join(", ")}`); return 0;
    }
    const options = { test: flags["--test"], outputDir: flags["--output"] ? resolve(flags["--output"]) : undefined, signal: controller.signal };
    const prepared = await prepareSuite(path, options);
    const result = await executeSuite(prepared, { ...options, progress: [
      consoleJourneyProgress(),
      { publish(event) {
        if (event.type === "execution-completed") console.log(`  ${event.result.profileId}: ${event.result.outcome.kind}`);
      } }
    ] });
    for (const test of result.tests) {
      console.log(`${testPassed(test) ? "PASS" : "FAIL"} ${test.id}`);
      for (const error of testFailures(test)) console.error(`  ${error.name}: ${error.message}`);
    }
    for (const error of result.errors) console.error(`  ${error.name}: ${error.message}`);
    await printReportLocation(prepared.outputDir);
    return result.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof JourneyConfigError) {
      console.error(error.testId ? `Configuration error in test ${JSON.stringify(error.testId)}:` : "Configuration error:");
      console.error(error.message);
      const alternative = error.testIds.find((id) => id !== error.testId);
      if (parsed && !parsed.flags["--test"] && error.testId && alternative) {
        console.error("Without --test, all configured tests must pass preflight. No tests were started.");
        console.error(`To select ${JSON.stringify(alternative)} only:\n  journey-mesh ${parsed.name} ${shellArgument(parsed.positionals[0])} --test ${shellArgument(alternative)}`);
      }
      return 2;
    }
    console.error(error instanceof Error ? error.message : "Journey Mesh failed");
    return 1;
  } finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  }
}

/** Serve only the generated artifact directory, bound to loopback. */
export async function serveReport(directory: string, port = 9323): Promise<Server> {
  const root = resolve(directory);
  await stat(resolve(root, "index.html"));
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".xml": "application/xml" };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const path = resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
      const child = relative(root, path);
      if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) { response.writeHead(403).end(); return; }
      const data = await readFile(path);
      response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "x-content-type-options": "nosniff" }); response.end(data);
    } catch { response.writeHead(404).end("Artifact not found"); }
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", done); });
  const address = server.address();
  console.log(`Journey Mesh report: http://127.0.0.1:${typeof address === "object" && address ? address.port : port}/`);
  return server;
}

function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:@-]+$/.test(value) ? value : "'" + value.split("'").join(`'"'"'`) + "'";
}
