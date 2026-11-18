import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { stringify } from "yaml";
import { runSuite, validateSuite, prepareSuite, loadSuiteConfig, runConfiguredServices } from "@openuji/journey-host";
import { fileArtifactStore, readReport } from "@openuji/journey-reporter";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.mjs`, import.meta.url));
const cli = resolve(root, "packages/journey-cli/bin/journey-mesh.mjs");
const exec = promisify(execFile);

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "journey-config-"));
  const config = {
    kind: "suite", outputDir: "reports", model: { use: fixture("model") },
    profiles: { basic: { use: fixture("profile") } },
    adapters: {
      first: { use: fixture("adapter"), options: { name: "first-provider", log: "events.jsonl" }, observers: [{ use: fixture("observer"), options: {} }] },
      second: { use: fixture("adapter"), options: { name: "second-provider", log: "events.jsonl" }, observers: [] }
    },
    tests: {
      sharing: {
        reporters: [{ use: fixture("reporter"), options: {} }],
        journeys: [
          { id: "alice", source: "model.json", select: "alice", adapter: "first" },
          { id: "bob", source: "model.json", select: "bob", adapter: "second" }
        ],
        profiles: [{ id: "default", journeys: { alice: "basic", bob: "basic" } }],
        environment: { use: fixture("environment"), options: { log: "events.jsonl" } }, timeoutMs: 5_000
      }
    }
  };
  const path = join(directory, "mesh.yaml");
  await writeFile(join(directory, "model.json"), JSON.stringify({ journeys: ["alice", "bob"] }));
  const save = () => writeFile(path, stringify(config));
  const events = async () => (await readFile(join(directory, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { event: string; name?: string; item?: string });
  await save();
  return { config, directory, path, save, events };
}

test("independent plugins compose ordered journeys sharing a touchpoint, fixtures, and reports", async () => {
  const suite = await setup();
  suite.config.tests.sharing.profiles.push({ id: "another", journeys: { alice: "basic", bob: "basic" } });
  await suite.save();
  const validation = await validateSuite(suite.path);
  assert.deepEqual(validation.tests, ["sharing"]);
  await assert.rejects(access(join(suite.directory, "events.jsonl")));
  await assert.rejects(access(join(suite.directory, "reports")));
  const result = await runSuite(suite.path);
  assert.equal(result.ok, true);
  const events = await suite.events();
  assert.deepEqual(events.map((event) => event.event), ["setup", "start", "start", "entry", "state", "entry", "state", "close", "close", "teardown", "setup", "start", "start", "entry", "state", "entry", "state", "close", "close", "teardown"]);
  assert.deepEqual(events.filter((event) => event.event === "state").map((event) => [event.name, event.item]), [["first-provider", "alice"], ["second-provider", "bob"], ["first-provider", "alice"], ["second-provider", "bob"]]);
  const operations = result.tests[0].result.evidence.executions[0].operations;
  assert.equal(new Set(operations.map((operation) => operation.operationId)).size, 2);
  const plan = result.tests[0].plan.operations;
  assert.deepEqual(plan.map((operation) => operation.segment), ["alice", "bob"]);
  assert.equal(operations[0].source?.references?.journeyItemId, undefined);
  assert.equal(operations[1].source?.references?.documentId, "model.json");
  assert.equal(operations[0].source?.references?.originalOperationId, "same-operation-id");
  assert.ok(Object.isFrozen(operations[0].source?.references));
  const output = join(suite.directory, "reports");
  const html = await readFile(join(output, "index.html"), "utf8");
  // Every link in the page markup resolves; inlined script and style content is not markup.
  const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, "");
  for (const [, href] of markup.matchAll(/(?:href|src)="([^"]+)"/g)) await access(join(output, decodeURIComponent(href)));
  assert.match(html, /<script type="module" crossorigin src=".\/assets\//);
  assert.doesNotMatch(html, /__JOURNEY_MESH_BUNDLE__/);
  assert.match(JSON.stringify(await readReport(output)), /fixture-evidence.txt/);
  await access(join(output, "sharing/fixture-evidence.txt"));
  // The host is the only bundle writer: one bundle per output directory, none per test.
  await assert.rejects(access(join(output, "sharing/bundle.json")));
  await assert.rejects(access(join(output, "sharing/index.html")));
});

test("same named adapter is shared while separate definitions remain isolated", async () => {
  const suite = await setup(); suite.config.tests.sharing.journeys[1].adapter = "first"; await suite.save();
  assert.equal((await runSuite(suite.path)).ok, true);
  const events = await suite.events();
  assert.equal(events.filter((event) => event.event === "start").length, 1);
  assert.equal(events.filter((event) => event.event === "close").length, 1);
  assert.equal(events.filter((event) => event.event === "entry").length, 2);
});

test("report phase exclusions are explicit, inherited, saved, and overridable without changing execution", async () => {
  const suite = await setup();
  Object.assign(suite.config, { report: { excludedPhaseIds: ["urn:phase:setup"] } });
  await suite.save();
  const inherited = await runSuite(suite.path);
  assert.deepEqual(inherited.tests[0].report, { excludedPhaseIds: ["urn:phase:setup"] });
  assert.equal(inherited.tests[0].plan.operations.length, 2);
  const saved = await readReport(join(suite.directory, "reports"), ["suite"]);
  assert.deepEqual(saved.tests[0].report, inherited.tests[0].report);
  Object.assign(suite.config.tests.sharing, { report: { excludedPhaseIds: [] } });
  await suite.save();
  assert.deepEqual((await runSuite(suite.path)).tests[0].report, { excludedPhaseIds: [] });
  Object.assign(suite.config.tests.sharing, { report: { unknown: true } });
  await suite.save();
  await assert.rejects(validateSuite(suite.path), /Unknown setting tests.sharing.report.unknown/);
});

test("suite storage policy reaches every artifact store and survives per-test phase overrides", async () => {
  const suite = await setup();
  Object.assign(suite.config, { report: { maxFileSizeMiB: 0.5, excludedPhaseIds: ["urn:phase:setup"] },
    services: { bounded: { use: fixture("service"), options: { name: "bounded", log: "events.jsonl" } } } });
  Object.assign(suite.config.tests.sharing, { report: { excludedPhaseIds: [] }, services: ["bounded"] });
  await suite.save();
  const prepared = await prepareSuite(suite.path);
  for (const store of [prepared.artifacts, ...prepared.tests.map((test) => test.artifacts), ...prepared.services.map((service) => service.artifacts)]) assert.equal(store.maxFileBytes, 524_288);
  const result = await runSuite(suite.path);
  assert.equal(result.storage?.maxFileBytes, 524_288);
  assert.deepEqual(result.tests[0].report, { excludedPhaseIds: [] });
  assert.equal((await readReport(join(suite.directory, "reports"))).storage?.maxFileBytes, 524_288);
  for (const maxFileSizeMiB of [0, -1, "5", 1e-20]) {
    Object.assign(suite.config, { report: { maxFileSizeMiB } }); await suite.save();
    await assert.rejects(validateSuite(suite.path), /positive safe byte count/);
  }
  Object.assign(suite.config, { report: { maxFileSizeMiB: 5 } });
  Object.assign(suite.config.tests.sharing, { report: { maxFileSizeMiB: 10 } }); await suite.save();
  await assert.rejects(validateSuite(suite.path), /Unknown setting tests.sharing.report.maxFileSizeMiB/);
});

test("failed journey stops its profile, retains cleanup/report failures, and independent tests continue", async () => {
  const suite = await setup();
  Object.assign(suite.config.adapters.first.options, { fail: "alice", failClose: true });
  suite.config.tests.sharing.reporters[0].options = { fail: true };
  Object.assign(suite.config.tests.sharing.environment.options, { failTeardown: true });
  const second = structuredClone(suite.config.tests.sharing);
  second.journeys = [{ id: "bob", source: "model.json", select: "bob", adapter: "second" }];
  second.profiles = [{ id: "independent", journeys: { bob: "basic" } } as typeof second.profiles[number]];
  Object.assign(suite.config.tests, { independent: second }); await suite.save();
  const result = await runSuite(suite.path);
  assert.equal(result.ok, false); assert.equal(result.tests.length, 2);
  assert.match(result.tests[0].result.errors.map((error) => error.message).join("\n"), /Fixture state failure.*Fixture close failure.*Fixture teardown failure/s);
  assert.match(result.tests[0].reportingErrors[0].message, /Fixture report failure/);
  const events = await suite.events();
  assert.deepEqual(events.filter((event) => event.event === "state").map((event) => event.item), ["alice", "bob"]);
  assert.equal(events.filter((event) => event.event === "teardown").length, 2);
  await access(join(suite.directory, "reports/index.html"));
});

test("partial adapter startup always closes children and tears down shared fixtures", async () => {
  const suite = await setup(); Object.assign(suite.config.adapters.second.options, { failStart: true }); await suite.save();
  assert.equal((await runSuite(suite.path)).ok, false);
  const events = await suite.events();
  assert.deepEqual(events.map((event) => event.event), ["setup", "start", "start", "close", "close", "teardown"]);
  assert.deepEqual(events.filter((event) => event.event === "close").map((event) => event.name), ["second-provider", "first-provider"]);
});

test("all selected tests preflight before any fixture mutation", async () => {
  const suite = await setup();
  const broken = structuredClone(suite.config.tests.sharing); broken.journeys[1].select = "missing";
  Object.assign(suite.config.tests, { broken }); await suite.save();
  await assert.rejects(runSuite(suite.path), /Unknown fixture journey/);
  await assert.rejects(access(join(suite.directory, "events.jsonl")));
  assert.equal((await runSuite(suite.path, { test: "sharing" })).ok, true);
});

for (const scenario of ["missing adapter", "missing profile", "missing assignment", "duplicate item", "unsupported target", "wrong plugin kind", "wrong observer automation"] as const) {
  test(`configuration rejects ${scenario} before setup`, async () => {
    const suite = await setup();
    if (scenario === "missing adapter") suite.config.tests.sharing.journeys[1].adapter = "missing";
    if (scenario === "missing profile") suite.config.tests.sharing.profiles[0].journeys.bob = "missing";
    if (scenario === "missing assignment") delete (suite.config.tests.sharing.profiles[0].journeys as Record<string, string>).bob;
    if (scenario === "duplicate item") suite.config.tests.sharing.journeys[1].id = "alice";
    if (scenario === "unsupported target") Object.assign(suite.config.adapters.second.options, { unsupported: "bob" });
    if (scenario === "wrong plugin kind") suite.config.adapters.first.use = fixture("profile");
    if (scenario === "wrong observer automation") {
      suite.config.adapters.first.observers[0].use = resolve(root, "packages/journey-observer-axe/src/plugin.ts");
      suite.config.adapters.first.observers[0].options = { reportId: "wrong-runtime" };
    }
    await suite.save();
    await assert.rejects(runSuite(suite.path), scenario === "wrong observer automation" ? /incompatible/ : { name: "JourneyConfigError" });
    await assert.rejects(access(join(suite.directory, "events.jsonl")));
  });
}

test("relative paths and selected environment interpolation do not mutate process.env or expose values", async () => {
  const suite = await setup();
  suite.config.adapters.first.options.name = "${PROVIDER}";
  suite.config.adapters.second.options.name = "${UNUSED_ANDROID_SECRET}";
  suite.config.tests.sharing.journeys[1].adapter = "first";
  Object.assign(suite.config, { envFiles: ["defaults.env", { path: "optional.env", optional: true }] });
  await writeFile(join(suite.directory, "defaults.env"), "PROVIDER=from-file\n"); await suite.save();
  const result = await runSuite(suite.path, { env: { PROVIDER: "from-process" } });
  assert.equal(result.ok, true);
  assert.equal((await suite.events()).find((event) => event.event === "start")?.name, "from-process");
  assert.equal(process.env.PROVIDER, undefined);
  await assert.rejects(validateSuite(suite.path, { env: { PROVIDER: "" } }), /Missing environment variable PROVIDER at adapters.first.options.name/);
  await writeFile(suite.path, "kind: suite\nkind: suite\n");
  await assert.rejects(loadSuiteConfig(suite.path), /unique/);
});

test("timeouts interrupt pending operations and retain cleanup", async () => {
  const suite = await setup(); suite.config.tests.sharing.timeoutMs = 40;
  Object.assign(suite.config.adapters.first.options, { delay: 100 }); await suite.save();
  const result = await runSuite(suite.path);
  assert.equal(result.ok, false); assert.match(result.tests[0].result.errors[0].message, /timeout/);
  const events = await suite.events();
  assert.equal(events.filter((event) => event.event === "close").length, 2);
  assert.equal(events.at(-1)?.event, "teardown");
  assert.ok(!events.some((event) => event.event === "state" && event.item === "bob"));
});

test("late startup resources are released after cancellation", async () => {
  const suite = await setup(); suite.config.tests.sharing.timeoutMs = 30;
  Object.assign(suite.config.adapters.first.options, { startDelay: 70 }); await suite.save();
  const result = await runSuite(suite.path); assert.equal(result.ok, false);
  await new Promise((done) => setTimeout(done, 100));
  assert.ok((await suite.events()).some((event) => event.event === "late-resource-released"));
  assert.equal((await suite.events()).filter((event) => event.event === "close").length, 1);
});

test("cooperative setup cancellation still runs teardown", async () => {
  const suite = await setup(); suite.config.tests.sharing.timeoutMs = 30;
  Object.assign(suite.config.tests.sharing.environment.options, { setupDelay: 1000 }); await suite.save();
  const result = await runSuite(suite.path); assert.equal(result.ok, false);
  assert.deepEqual((await suite.events()).map((event) => event.event), ["setup", "teardown"]);
});

test("CLI validates, executes and uses nonzero exit codes for invalid config and run failures", async () => {
  const suite = await setup();
  const validation = await exec(process.execPath, [cli, "validate", suite.path, "--test", "sharing"], { cwd: tmpdir() });
  assert.match(validation.stdout, /Valid tests: sharing/);
  const run = await exec(process.execPath, [cli, "test", suite.path], { cwd: tmpdir() }); assert.match(run.stdout, /PASS sharing/);
  await assert.rejects(exec(process.execPath, [cli, "test", suite.path, "--test", "missing"]), (error: unknown) => (error as { code: number }).code === 2);
  Object.assign(suite.config.adapters.first.options, { fail: "alice" }); await suite.save();
  await assert.rejects(exec(process.execPath, [cli, "test", suite.path]), (error: unknown) => (error as { code: number }).code === 1);
});

test("CLI interruption produces reports after closing runtimes and fixtures", async () => {
  const suite = await setup(); Object.assign(suite.config.adapters.first.options, { delay: 500 }); await suite.save();
  const child = spawn(process.execPath, [cli, "test", suite.path], { stdio: ["ignore", "pipe", "pipe"] });
  const exit = new Promise<number | null>((done) => child.once("exit", done));
  try {
    let running = false;
    for (let count = 0; count < 200; count++) {
      try { running = (await suite.events()).some((event) => event.event === "state"); } catch {}
      if (running) break;
      await new Promise((done) => setTimeout(done, 10));
    }
    assert.equal(running, true); child.kill("SIGTERM"); assert.equal(await exit, 1);
    assert.equal((await suite.events()).at(-1)?.event, "teardown"); await access(join(suite.directory, "reports/index.html"));
  } finally { child.kill("SIGKILL"); }
});

test("artifact store refuses traversal", async () => {
  const artifacts = fileArtifactStore(await mkdtemp(join(tmpdir(), "journey-store-")));
  await assert.rejects(artifacts.write({ name: "../escape.json", data: "secret", contentType: "application/json" }));
});

test("numeric-looking test names preserve YAML declaration order and dot names stay inside the output root", async () => {
  const suite = await setup(); const definition = suite.config.tests.sharing;
  // JSON/JS object enumeration would reorder these names; YAML declaration order is authoritative.
  const source = stringify({ ...suite.config, tests: {} });
  const block = stringify({ sharing: definition }).replace(/^sharing:/, '"20":');
  const blocks = [block, block.replace(/^"20":/, '"3":'), block.replace(/^"20":/, '"..":')].map((item) => item.split("\n").filter(Boolean).map((line) => `  ${line}`).join("\n"));
  await writeFile(suite.path, source.replace("tests: {}", `tests:\n${blocks.join("\n")}`));
  const result = await runSuite(suite.path);
  assert.deepEqual(result.tests.map((test) => test.id), ["20", "3", ".."]);
  assert.ok(result.tests[2].artifacts.length > 0);
  await access(join(suite.directory, "reports/%2E%2E", result.tests[2].artifacts[0].href));
});

test("missing device configuration identifies its test and suggests explicit selection without starting fixtures", async () => {
  const suite = await setup();
  suite.config.tests.sharing.journeys[1].adapter = "first";
  const deviceTest = structuredClone(suite.config.tests.sharing);
  deviceTest.journeys = [{ id: "bob", source: "model.json", select: "bob", adapter: "second" }];
  deviceTest.profiles = [{ id: "device", journeys: { bob: "basic" } } as typeof deviceTest.profiles[number]];
  Object.assign(suite.config.tests, { "device-required": deviceTest });
  Object.assign(suite.config.adapters.second.options, { device: "${JOURNEY_TEST_REQUIRED_DEVICE}" });
  await suite.save();
  const env = { ...process.env };
  delete env.JOURNEY_TEST_REQUIRED_DEVICE;
  await assert.rejects(exec(process.execPath, [cli, "test", suite.path], { env }), (error: unknown) => {
    const failure = error as { code: number; stderr: string };
    assert.equal(failure.code, 2);
    assert.match(failure.stderr, /Configuration error in test "device-required"/);
    assert.match(failure.stderr, /Missing environment variable JOURNEY_TEST_REQUIRED_DEVICE/);
    assert.match(failure.stderr, /all configured tests must pass preflight\. No tests were started/);
    assert.match(failure.stderr, /journey-mesh test .* --test sharing/);
    return true;
  });
  await assert.rejects(access(join(suite.directory, "events.jsonl")));
  const validation = await exec(process.execPath, [cli, "validate", suite.path, "--test", "sharing"], { env });
  assert.match(validation.stdout, /Valid tests: sharing/);
});

function serviceEntry(name: string, options: Record<string, unknown> = {}, dependsOn?: readonly string[]) {
  return { use: fixture("service"), options: { name, log: "service-events.jsonl", ...options }, ...(dependsOn ? { dependsOn } : {}) };
}

async function serviceEvents(directory: string) {
  return (await readFile(join(directory, "service-events.jsonl"), "utf8")).trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string; name: string });
}

test("services run in dependsOn order for up, reverse for down, and a single selection does not cascade", async () => {
  const suite = await setup();
  const config = { ...suite.config, services: { a: serviceEntry("a"), b: serviceEntry("b", {}, ["a"]) } };
  await writeFile(suite.path, stringify(config));
  await runConfiguredServices(suite.path, "up");
  assert.deepEqual((await serviceEvents(suite.directory)).map((event) => `${event.name}:${event.event}`), ["a:up", "b:up"]);
  await runConfiguredServices(suite.path, "down");
  assert.deepEqual((await serviceEvents(suite.directory)).slice(2).map((event) => `${event.name}:${event.event}`), ["b:down", "a:down"]);
  await writeFile(join(suite.directory, "service-events.jsonl"), "");
  await runConfiguredServices(suite.path, "up", { service: "b" });
  assert.deepEqual((await serviceEvents(suite.directory)).map((event) => `${event.name}:${event.event}`), ["b:up"]);
});

test("services up stops at the first failure; down is best-effort across every entry", async () => {
  const suite = await setup();
  await writeFile(suite.path, stringify({
    ...suite.config,
    services: { a: serviceEntry("a", { failUp: true }), b: serviceEntry("b", {}, ["a"]) }
  }));
  await assert.rejects(runConfiguredServices(suite.path, "up"), /services\.a:.*up failure/);
  assert.deepEqual((await serviceEvents(suite.directory)).map((event) => `${event.name}:${event.event}`), ["a:up"]);
  await writeFile(join(suite.directory, "service-events.jsonl"), "");
  await writeFile(suite.path, stringify({
    ...suite.config,
    services: { a: serviceEntry("a", { failDown: true }), b: serviceEntry("b", { failDown: true }, ["a"]) }
  }));
  await assert.rejects(runConfiguredServices(suite.path, "down"), (error: unknown) => {
    assert.match((error as Error).message, /services\.b:.*down failure/s);
    assert.match((error as Error).message, /services\.a:.*down failure/s);
    return true;
  });
  assert.deepEqual((await serviceEvents(suite.directory)).map((event) => `${event.name}:${event.event}`), ["b:down", "a:down"]);
});

test("an unknown service selection is rejected", async () => {
  const suite = await setup();
  await writeFile(suite.path, stringify({ ...suite.config, services: { a: serviceEntry("a") } }));
  await assert.rejects(runConfiguredServices(suite.path, "up", { service: "missing" }), /Unknown service missing/);
});

test("managed services start dependencies once and clean up after partial startup failures", async () => {
  const suite = await setup();
  Object.assign(suite.config, { services: {
    service: { use: fixture("service"), options: { name: "service", log: "events.jsonl" } },
    automation: { use: fixture("service"), dependsOn: ["service"], options: { name: "automation", log: "events.jsonl", failUp: true } }
  } });
  Object.assign(suite.config.tests.sharing, { services: ["automation"] }); await suite.save();
  const bundle = await runSuite(suite.path);
  assert.equal(bundle.ok, false);
  assert.match(bundle.errors[0].message, /up failure/);
  assert.deepEqual((await suite.events()).map(({ event, name }) => [event, name]), [["up", "service"], ["up", "automation"], ["down", "automation"], ["down", "service"]]);
});

test("operation aliases are resolved by the model binding before observers are created", async () => {
  const suite = await setup();
  Object.assign(suite.config.tests.sharing.journeys[0], { operations: { arrival: "same-operation-id" } });
  suite.config.adapters.first.observers[0] = { use: resolve(root, "packages/journey-observer-ux/src/plugin.ts"), options: { id: "ux", counters: [{ id: "effort", label: "Effort", from: "alice.arrival", until: "alice.arrival" }] } };
  // The UX observer's automation must match; this assertion proves validation happens before fixtures.
  await suite.save();
  await assert.rejects(validateSuite(suite.path), /incompatible/);
  suite.config.adapters.first.observers = [];
  await suite.save();
  assert.deepEqual((await validateSuite(suite.path)).tests, ["sharing"]);
  Object.assign(suite.config.tests.sharing.journeys[0], { operations: { arrival: "unknown-operation" } }); await suite.save();
  await assert.rejects(validateSuite(suite.path), /Unknown fixture operation/);
  await assert.rejects(access(join(suite.directory, "events.jsonl")));
});
