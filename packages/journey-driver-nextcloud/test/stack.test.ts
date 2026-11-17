import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileArtifactStore } from "@openuji/journey-reporter";
import { nextcloudStackRuntime, validateStackOptions, type StackOptions, type StackExecutor } from "../src/runtime/stack.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "nextcloud-runtime-"));
  const options: StackOptions = { project: "isolated-stack", composeFiles: ["/compose.yaml"], image: "nextcloud@sha256:pinned", expectedVersion: "34.0.2", directory, environment: { PASSWORD: "literal$# value" }, enabledApps: ["notifications"], services: { first: { baseURL: "http://example.test:18081", username: "account", password: "private-password" } } };
  const artifacts = fileArtifactStore(join(directory, "evidence"));
  const calls: readonly string[][] = [];
  const execute: StackExecutor = async (command, args) => {
    (calls as string[][]).push([command, ...args]);
    if (args.includes("status")) return JSON.stringify({ installed: true, versionstring: "34.0.2" });
    if (args.includes("app:list")) return JSON.stringify({ enabled: { notifications: "1.0" } });
    if (args.includes("inspect")) return "sha256:actual-image";
    return "";
  };
  return { options, artifacts, calls, execute };
}

test("Nextcloud lifecycle owns provisioning, verifies image identity, and publishes credential-free provenance", async () => {
  const { options, artifacts, calls, execute } = await fixture();
  const runtime = nextcloudStackRuntime(options, artifacts, execute);
  assert.equal(calls.length, 0);
  await runtime.up(); await runtime.down!();
  assert.ok(calls.every((call) => call[0] !== "docker" || call[1] === "image" || call[1] === "inspect" || call.includes(options.project) || call.includes(`label=com.docker.compose.project=${options.project}`)));
  assert.ok(calls.some((call) => call.includes("allow_local_remote_servers")));
  assert.ok(calls.some((call) => call.includes("--volumes")));
  const identity = JSON.stringify(runtime.provenance!());
  assert.match(identity, /sha256:actual-image/);
  assert.doesNotMatch(identity, /private-password|literal\$/);
  assert.equal(artifacts.files.length, 1);
  assert.match(await readFile(join(options.directory, "stack.env"), "utf8"), /PASSWORD='literal\$# value'/);
});

test("identity mismatch fails verification rather than publishing a successful deployment", async () => {
  const { options, artifacts, execute } = await fixture();
  const runtime = nextcloudStackRuntime(options, artifacts, async (command, args, context) => args[0] === "image" ? "sha256:unexpected" : execute(command, args, context));
  await assert.rejects(runtime.up(), /image mismatch/);
  assert.equal(artifacts.files.length, 0);
});

test("untrusted source pins and shared service origins are rejected before allocation", async () => {
  const { options } = await fixture();
  assert.throws(() => validateStackOptions({ ...options, build: { repository: "https://example.test/source.git", sha: "main", directory: "/source", dockerfile: "/Dockerfile", apps: [] } }), /exact commit/);
  assert.throws(() => validateStackOptions({ ...options, services: { ...options.services, duplicate: options.services.first } }), /distinct HTTP/);
});

test("rejecting an existing project does not delete its containers or volumes during cleanup", async () => {
  const { options, artifacts, calls, execute } = await fixture();
  const runtime = nextcloudStackRuntime(options, artifacts, async (command, args, context) => args.includes("ps") ? "existing-container" : execute(command, args, context));
  await assert.rejects(runtime.up(), /already has containers/);
  await runtime.down!();
  assert.ok(!calls.some((call) => call.includes("down") || call.includes("up")));
});
