import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObservationPublisher } from "@openuji/journey-plugin";
import { composeProgressState, releaseComposeStack, startComposeStack, validateComposeConfiguration, type ComposeExecutor, type ComposeProjectTools, type ComposeStackOptions } from "../src/compose.js";
import { composeLifecycle, composeProgress, type ComposeLifecycleObservation, type ComposeProgressObservation } from "../src/observations.js";

/** A vendor-neutral stack: what a second vendor (say, Moodle) would hand to the lifecycle. */
async function fixture(respond: (args: readonly string[]) => string | undefined = () => undefined) {
  const directory = await mkdtemp(join(tmpdir(), "compose-stack-"));
  const stack: ComposeStackOptions = { label: "Moodle", project: "moodle-stack", composeFiles: ["/compose.yaml"], directory, environment: { ADMIN_PASSWORD: "it's $ecret #1" },
    envFileVariable: "MOODLE_STACK_ENV_FILE", services: ["moodle"], ownershipFile: join(directory, "ownership.json") };
  const calls: string[][] = [];
  const phases: string[] = [];
  let up = false;
  const execute: ComposeExecutor = async (command, args) => {
    calls.push([command, ...args]);
    const answer = respond(args);
    if (answer !== undefined) return answer;
    if (args.includes("up")) up = true;
    return args.includes("ps") && up ? "container-1" : "";
  };
  const observations: ObservationPublisher = { async publish(topic, value) {
    assert.equal(topic.id, composeLifecycle.id);
    phases.push((value as ComposeLifecycleObservation).phase);
  } };
  return { stack, calls, phases, execute, observations };
}

test("a stack prepares, writes its private env file, starts, bootstraps and releases only what it started", async () => {
  const { stack, calls, phases, execute, observations } = await fixture();
  const order: string[] = [];
  const lease = await startComposeStack(stack, {
    async prepare({ run }) { order.push("prepare"); await run("docker", ["build", "-t", "moodle:local", "."]); return { MOODLE_IMAGE: "moodle:local" }; },
    async bootstrap({ compose }) { order.push(`bootstrap after ${phases.join(",")}`); await compose("exec", "-T", "moodle", "php", "admin/cli/install.php"); return { outputs: { site: "ready" }, provenance: { image: "moodle:local" } }; }
  }, { observations }, { execute });
  assert.deepEqual(order, ["prepare", "bootstrap after allocated"]);
  assert.deepEqual(lease.outputs, { site: "ready" });
  assert.equal(await readFile(join(stack.directory, "stack.env"), "utf8"), "ADMIN_PASSWORD='it\\'s $ecret #1'\nMOODLE_IMAGE='moodle:local'\n");
  assert.deepEqual(JSON.parse(await readFile(stack.ownershipFile, "utf8")).containers, ["container-1"]);
  await lease.release();
  assert.deepEqual(phases, ["allocated", "before-release"]);
  assert.ok(calls.at(-1)!.includes("down") && calls.at(-1)!.includes("--volumes"));
  await assert.rejects(readFile(stack.ownershipFile, "utf8"), { code: "ENOENT" });
});

test("an existing project is refused before anything is started, owned or removed", async () => {
  const { stack, calls, phases, execute, observations } = await fixture((args) => args.includes("ps") ? "foreign-container" : undefined);
  await assert.rejects(startComposeStack(stack, { bootstrap: async () => ({ outputs: {} }) }, { observations }, { execute }), /moodle-stack already has containers/);
  assert.ok(!calls.some((call) => call.includes("up") || call.includes("down")));
  assert.deepEqual(phases, []);
});

test("a failed bootstrap is compensated, and a failed compensation names the stack", async () => {
  const failed = await fixture();
  await assert.rejects(startComposeStack(failed.stack, { bootstrap: async () => { throw new Error("install failed"); } }, failed, { execute: failed.execute }), /install failed/);
  assert.deepEqual(failed.phases, ["allocated", "before-release"]);
  assert.ok(failed.calls.some((call) => call.includes("down")));
  const both = await fixture((args) => args.includes("down") ? (() => { throw new Error("down failed"); })() : undefined);
  await assert.rejects(startComposeStack(both.stack, { bootstrap: async () => { throw new Error("install failed"); } }, both, { execute: both.execute }),
    (error: unknown) => error instanceof AggregateError && error.message === "Moodle startup and cleanup failed: install failed; cleanup: down failed");
});

test("an explicit release leaves a project alone once it no longer holds only this acquisition's containers", async () => {
  const { stack, execute, observations } = await fixture();
  await startComposeStack(stack, { bootstrap: async () => ({ outputs: {} }) }, { observations }, { execute });
  const replaced: ComposeExecutor = async (command, args, context) => args.includes("ps") ? "container-1\nsomeone-else" : execute(command, args, context);
  await assert.rejects(releaseComposeStack(stack.ownershipFile, { envFileVariable: stack.envFileVariable, execute: replaced }), /no longer belongs to this acquisition/);
  await releaseComposeStack(stack.ownershipFile, { envFileVariable: stack.envFileVariable, execute });
  await assert.rejects(readFile(stack.ownershipFile, "utf8"), { code: "ENOENT" });
});

test("startup output is published once per state a layer or container reaches, before the allocation", async () => {
  const { stack, execute } = await fixture();
  const published: string[] = [];
  const observations: ObservationPublisher = { async publish(topic, value) {
    published.push(topic.id === composeProgress.id ? (value as ComposeProgressObservation).line : (value as ComposeLifecycleObservation).phase);
  } };
  /** As `docker compose up -d` prints it without a terminal. */
  const output = [" 821d9dafb26d Pulling fs layer \n", " 821d9dafb26d Downloading [=====>      ]  1.049MB/1.896MB\n 821d9dafb26d Downloading [=========>  ]  1.5",
    "MB/1.896MB\n 821d9dafb26d Download complete \n 821d9dafb26d Extracting 1 s\n 821d9dafb26d Extracting 2 s\n 821d9dafb26d Pull complete \n Container moodle-1  Started"];
  const verbose: ComposeExecutor = async (command, args, options) => {
    if (args.includes("up")) for (const chunk of output) options.onOutput?.(chunk);
    return execute(command, args, options);
  };
  await startComposeStack(stack, { bootstrap: async () => ({ outputs: {} }) }, { observations }, { execute: verbose });
  assert.deepEqual(published, ["821d9dafb26d Pulling fs layer", "821d9dafb26d Downloading", "821d9dafb26d Download complete",
    "821d9dafb26d Extracting", "821d9dafb26d Pull complete", "Container moodle-1 Started", "allocated"]);
  assert.equal(composeProgressState(" abc Extracting [==>   ]  2MB/9MB"), "abc Extracting");
});

test("a progress state drops the counters of every Compose release", () => {
  /** As Compose 5.5.0 printed them on a hosted runner. */
  const states = [
    [" 6cfa3c1603d5 Pulling fs layer 0B", "6cfa3c1603d5 Pulling fs layer"],
    [" 7a36a4ed4172 Downloading 171B", "7a36a4ed4172 Downloading"],
    [" 2bf13d043bf5 Downloading 1.049MB", "2bf13d043bf5 Downloading"],
    [" 59b353deb50e Downloading 901.1kB", "59b353deb50e Downloading"],
    [" 6cfa3c1603d5 Extracting 390B", "6cfa3c1603d5 Extracting"],
    [" 6cfa3c1603d5 Download complete 0B", "6cfa3c1603d5 Download complete"],
    [" 6cfa3c1603d5 Downloading 1.049MB / 1.896MB", "6cfa3c1603d5 Downloading"],
    [" Image postgres:16-alpine Pulled ", "Image postgres:16-alpine Pulled"],
    [" Container moodle-stack-app-1  Started", "Container moodle-stack-app-1 Started"]
  ] as const;
  for (const [line, state] of states) assert.equal(composeProgressState(line), state);
});

/** Runs `bootstrap` against a started stack whose `ps --status exited` answers `exited`. */
async function waiting(bootstrap: (tools: ComposeProjectTools) => Promise<void>, exited = "", signal?: AbortSignal) {
  const { stack, calls, execute, observations } = await fixture((args) => args.includes("--status") ? exited : undefined);
  const started = startComposeStack(stack, { bootstrap: async (tools) => { await bootstrap(tools); return { outputs: {} }; } }, { observations }, { execute, signal });
  return { started, calls };
}

test("waiting for a service ends as soon as nothing is pending", async () => {
  let polls = 0;
  const { started } = await waiting(({ untilReady }) => untilReady("moodle", async () => ++polls < 2 ? "not installed" : undefined));
  await started;
  assert.equal(polls, 2);
});

test("waiting fails at once when the service's container has exited, and releases the stack", async () => {
  const { started, calls } = await waiting(({ untilReady }) => untilReady("moodle", async () => "the application is not installed"), "container-1");
  await assert.rejects(started, /moodle: its container exited before it was ready: the application is not installed/);
  assert.deepEqual(calls.find((call) => call.includes("--status"))!.slice(-6), ["ps", "--all", "--quiet", "--status", "exited", "moodle"]);
  assert.ok(calls.some((call) => call.includes("down")));
});

test("waiting is limited by time, also while a check hangs", async () => {
  const slow = await waiting(({ untilReady }) => untilReady("moodle", async () => "the application is not installed", { timeoutMs: 20 }));
  await assert.rejects(slow.started, /moodle: not ready after 0s: the application is not installed/);
  const hung = await waiting(({ untilReady }) => untilReady("moodle", () => new Promise<string>(() => {}), { timeoutMs: 20 }));
  await assert.rejects(hung.started, /moodle: not ready after 0s: it has not answered/);
});

test("cancellation ends the wait with its reason", async () => {
  const controller = new AbortController();
  const { started } = await waiting(({ untilReady }) => untilReady("moodle", async () => { controller.abort(new Error("cancelled")); return "pending"; }), "", controller.signal);
  await assert.rejects(started, /cancelled/);
});

test("configuration that holds for any stack is validated before allocation", () => {
  const valid = { project: "moodle-stack", composeFiles: ["/compose.yaml"], services: ["moodle"], environment: { KEY: "value" } };
  validateComposeConfiguration(valid);
  assert.throws(() => validateComposeConfiguration({ ...valid, project: "Moodle Stack" }), /Invalid Compose project name/);
  assert.throws(() => validateComposeConfiguration({ ...valid, services: [] }), /Compose files and services are required/);
  assert.throws(() => validateComposeConfiguration({ ...valid, environment: { key: "value" } }), /Invalid stack environment entry/);
});
