import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObservationPublisher } from "@openuji/journey-plugin";
import { releaseComposeStack, startComposeStack, validateComposeConfiguration, type ComposeExecutor, type ComposeStackOptions } from "../src/compose.js";
import { composeLifecycle, type ComposeLifecycleObservation } from "../src/observations.js";

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
    (error: unknown) => error instanceof AggregateError && error.message === "Moodle startup and cleanup failed");
});

test("an explicit release leaves a project alone once it no longer holds only this acquisition's containers", async () => {
  const { stack, execute, observations } = await fixture();
  await startComposeStack(stack, { bootstrap: async () => ({ outputs: {} }) }, { observations }, { execute });
  const replaced: ComposeExecutor = async (command, args, context) => args.includes("ps") ? "container-1\nsomeone-else" : execute(command, args, context);
  await assert.rejects(releaseComposeStack(stack.ownershipFile, { envFileVariable: stack.envFileVariable, execute: replaced }), /no longer belongs to this acquisition/);
  await releaseComposeStack(stack.ownershipFile, { envFileVariable: stack.envFileVariable, execute });
  await assert.rejects(readFile(stack.ownershipFile, "utf8"), { code: "ENOENT" });
});

test("configuration that holds for any stack is validated before allocation", () => {
  const valid = { project: "moodle-stack", composeFiles: ["/compose.yaml"], services: ["moodle"], environment: { KEY: "value" } };
  validateComposeConfiguration(valid);
  assert.throws(() => validateComposeConfiguration({ ...valid, project: "Moodle Stack" }), /Invalid Compose project name/);
  assert.throws(() => validateComposeConfiguration({ ...valid, services: [] }), /Compose files and services are required/);
  assert.throws(() => validateComposeConfiguration({ ...valid, environment: { key: "value" } }), /Invalid stack environment entry/);
});
