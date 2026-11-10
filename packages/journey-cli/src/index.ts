import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { JourneyConfigError, runConfiguredRuntime, runConfiguredTests, validateConfiguredTests } from "@openuji/journey-runtime";
import { consoleJourneyProgress } from "@openuji/journey-runner/console";

const help = `Usage:
  journey-mesh test <config.yaml> [--test <id>]
  journey-mesh validate <config.yaml> [--test <id>]
  journey-mesh runtime up <config.yaml> [--runtime <key>]
  journey-mesh runtime down <config.yaml> [--runtime <key>]
  journey-mesh report <directory> [--port <number>]

Without --test, every test in the YAML is selected and must pass preflight.
Without --runtime, every entry in the YAML's runtimes section is selected.`;
export async function main(args: string[]): Promise<number> {
  if (!args.length || args.includes("--help")) { console.log(help); return 0; }
  if (args[0] === "runtime") {
    const [, runtimeAction, path, ...flags] = args;
    try {
      if (!["up", "down"].includes(runtimeAction ?? "") || !path || path.startsWith("--")) throw new JourneyConfigError(help);
      let runtime: string | undefined;
      for (let index = 0; index < flags.length; index += 2) {
        const flag = flags[index]; const value = flags[index + 1];
        if (!value || value.startsWith("--")) throw new JourneyConfigError(`Missing value for ${flag}`);
        if (flag === "--runtime") runtime = value;
        else throw new JourneyConfigError(`Unknown option ${flag}`);
      }
      // No SIGINT/SIGTERM handler: androidUp/appiumUp (and any other runtime
      // plugin) do not check an abort signal mid-operation, so installing one
      // here would only replace Node's default terminate-on-signal behavior
      // with a no-op, making Ctrl-C appear to hang instead of exiting.
      await runConfiguredRuntime(path, runtimeAction as "up" | "down", { runtime });
      return 0;
    } catch (error) {
      if (error instanceof JourneyConfigError) { console.error(error.message); return 2; }
      console.error(error instanceof Error ? error.message : "Journey Mesh failed");
      return 1;
    }
  }
  const [command, path, ...flags] = args;
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Journey test interrupted"));
  let test: string | undefined;
  try {
    if (!["test", "validate", "report"].includes(command) || !path || path.startsWith("--")) throw new JourneyConfigError(help);
    let port = 9323;
    for (let index = 0; index < flags.length; index += 2) {
      const flag = flags[index]; const value = flags[index + 1];
      if (!value || value.startsWith("--")) throw new JourneyConfigError(`Missing value for ${flag}`);
      if (flag === "--test" && command !== "report") test = value;
      else if (flag === "--port" && command === "report" && /^\d+$/.test(value) && Number(value) <= 65535) port = Number(value);
      else throw new JourneyConfigError(`Unknown option ${flag}`);
    }
    if (command === "report") {
      await serveReport(path, port); return 0;
    }
    process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
    if (command === "validate") {
      const result = await validateConfiguredTests(path, { test, signal: controller.signal });
      console.log(`Valid tests: ${result.tests.join(", ")}`); return 0;
    }
    const result = await runConfiguredTests(path, { test, signal: controller.signal, progress: [
      consoleJourneyProgress(),
      { publish(event) {
        if (event.type === "execution-completed") console.log(`  ${event.result.profileId}: ${event.result.outcome.kind}`);
      } }
    ] });
    for (const test of result.tests) {
      console.log(`${test.result.ok && !test.reportingErrors.length ? "PASS" : "FAIL"} ${test.id}`);
      for (const error of [...test.result.errors, ...test.reportingErrors]) console.error(`  ${error.name}: ${error.message}`);
    }
    console.log(`Report: ${resolve(result.outputDir, "index.html")}`);
    return result.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof JourneyConfigError) {
      console.error(error.testId ? `Configuration error in test ${JSON.stringify(error.testId)}:` : "Configuration error:");
      console.error(error.message);
      const alternative = error.testIds.find((id) => id !== error.testId);
      if (!test && error.testId && alternative) {
        console.error("Without --test, all configured tests must pass preflight. No tests were started.");
        console.error(`To select ${JSON.stringify(alternative)} only:\n  journey-mesh ${command} ${shellArgument(path)} --test ${shellArgument(alternative)}`);
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
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".png": "image/png", ".xml": "application/xml" };
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
