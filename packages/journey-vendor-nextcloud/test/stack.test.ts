import assert from "node:assert/strict";
import test from "node:test";
import type { ObservationPublisher } from "@openuji/journey-plugin";
import { composeLifecycle, type ComposeLifecycleObservation } from "@openuji/journey-service-docker/observations";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileEvidenceStore } from "@openuji/journey-run-record/node";
import { executeStackCommand, nextcloudStackRuntime, validateStackOptions, type StackOptions, type StackExecutor } from "../src/services/stack/stack.js";

test("stack commands parse stdout separately while retaining stderr on failure", async () => {
  const output = await executeStackCommand(process.execPath, ["-e", 'console.error("warning"); console.log(JSON.stringify({ installed: true }))'], { cwd: process.cwd(), env: process.env });
  assert.deepEqual(JSON.parse(output), { installed: true });
  await assert.rejects(executeStackCommand(process.execPath, ["-e", 'console.error("command diagnostic"); process.exit(1)'], { cwd: process.cwd(), env: process.env }), /command diagnostic/);
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "nextcloud-runtime-"));
  const options: StackOptions = { project: "isolated-stack", composeFiles: ["/compose.yaml"], image: "nextcloud@sha256:pinned", expectedVersion: "34.0.2", directory, environment: { PASSWORD: "literal$# value" }, enabledApps: ["notifications"], services: { first: { baseURL: "http://example.test:18081", username: "account", password: "private-password" } } };
  const artifacts = fileEvidenceStore(join(directory, "evidence"));
  const calls: readonly string[][] = [];
  /** config.php as `occ config:system:set|get` see it, by key path (e.g. "trusted_domains 0"). */
  const systemConfig = new Map<string, string>();
  const execute: StackExecutor = async (command, args) => {
    (calls as string[][]).push([command, ...args]);
    const occ = args.indexOf("occ");
    if (occ >= 0 && args[occ + 1] === "config:system:set") {
      systemConfig.set(args.slice(occ + 2).filter((arg) => !arg.startsWith("--")).join(" "), args.find((arg) => arg.startsWith("--value="))!.slice("--value=".length));
      return "";
    }
    if (occ >= 0 && args[occ + 1] === "config:system:get") return systemConfig.get(args.slice(occ + 2).join(" ")) ?? "";
    if (args.includes("status")) return JSON.stringify({ installed: true, versionstring: "34.0.2" });
    if (args.includes("app:list")) return JSON.stringify({ enabled: { notifications: "1.0" } });
    if (args.includes("inspect")) return "sha256:actual-image";
    return "";
  };
  return { options, artifacts, calls, systemConfig, execute, ports: { artifacts, observations: recordingPublisher(() => {}) } };
}

/** The image's entrypoint still runs as PID 1 for the first `checks` reads of /proc/1/cmdline, then execs Apache. */
function entrypointRunning(inner: StackExecutor, checks: number): StackExecutor {
  let seen = 0;
  return (command, args, context) => args.at(-1) === "/proc/1/cmdline"
    ? Promise.resolve(++seen <= checks ? "/bin/sh\0/entrypoint.sh\0apache2-foreground" : "apache2-foreground")
    : inner(command, args, context);
}

test("configuration waits until the image's entrypoint has finished writing config.php", async () => {
  const { options, ports, calls, execute } = await fixture();
  const lease = await nextcloudStackRuntime(options, ports, entrypointRunning(execute, 1)).start({}); await lease.release();
  const firstWrite = calls.findIndex((call) => call.includes("config:system:set"));
  const statusPolls = calls.filter((call, index) => index < firstWrite && call.includes("status"));
  assert.equal(statusPolls.length, 2, "polls again while the entrypoint is still PID 1");
});

test("a service whose container exits during installation fails at once, naming that rather than its version", async () => {
  const { options, ports, calls, execute } = await fixture();
  const crashed: StackExecutor = async (command, args, context) => {
    if (args.includes("--status")) return "container-1";
    if (args.includes("status")) throw new Error("service is not running");
    return execute(command, args, context);
  };
  await assert.rejects(nextcloudStackRuntime(options, ports, crashed).start({}), /first: its container exited before it was ready: Nextcloud is not installed/);
  assert.ok(calls.some((call) => call.includes("down")));
});

test("readyTimeoutMs bounds the wait and says what was still missing", async () => {
  const { options, ports, execute } = await fixture();
  const runtime = nextcloudStackRuntime({ ...options, readyTimeoutMs: 20 }, ports, entrypointRunning(execute, Number.POSITIVE_INFINITY));
  await assert.rejects(runtime.start({}), /first: not ready after 0s: the image's entrypoint script did not finish/);
});

test("a setting another config.php writer dropped is applied again, and one that never sticks fails startup", async () => {
  const flaky = await fixture();
  let dropped = false;
  const dropOnce: StackExecutor = async (command, args, context) => {
    const result = await flaky.execute(command, args, context);
    if (!dropped && args.includes("config:system:get") && args.at(-1) === "allow_local_remote_servers") { dropped = true; return "false"; }
    return result;
  };
  const lease = await nextcloudStackRuntime(flaky.options, flaky.ports, dropOnce).start({}); await lease.release();
  assert.equal(flaky.calls.filter((call) => call.includes("config:system:set") && call.includes("allow_local_remote_servers")).length, 2);
  const stuck = await fixture();
  const neverSticks: StackExecutor = async (command, args, context) =>
    args.includes("config:system:get") && args.at(-1) === "allow_local_remote_servers" ? "false" : stuck.execute(command, args, context);
  await assert.rejects(nextcloudStackRuntime(stuck.options, stuck.ports, neverSticks).start({}), /first: allow_local_remote_servers did not keep the configured value/);
  assert.ok(stuck.calls.some((call) => call.includes("down")), "the failed acquisition is released");
});

/** Awaits each delivery like the host's publisher; source stamping and deadlines are tested in journey-host. */
function recordingPublisher(observe: (value: ComposeLifecycleObservation) => Promise<void> | void): ObservationPublisher {
  return { async publish(topic, value) { assert.equal(topic.id, composeLifecycle.id); await observe(value as ComposeLifecycleObservation); } };
}

test("Nextcloud lifecycle owns provisioning, verifies image identity, and publishes credential-free provenance", async () => {
  const { options, artifacts, calls, execute, ports } = await fixture();
  const runtime = nextcloudStackRuntime(options, ports, execute);
  assert.equal(calls.length, 0);
  const lease = await runtime.start({}); await lease.release();
  assert.ok(calls.every((call) => call[0] !== "docker" || call[1] === "image" || call[1] === "inspect" || call.includes(options.project) || call.includes(`label=com.docker.compose.project=${options.project}`)));
  assert.ok(calls.some((call) => call.includes("allow_local_remote_servers")));
  assert.ok(calls.some((call) => call.includes("--volumes")));
  const identity = JSON.stringify(lease.provenance);
  assert.match(identity, /sha256:actual-image/);
  assert.doesNotMatch(identity, /private-password|literal\$/);
  assert.equal(artifacts.files.length, 1);
  assert.match(await readFile(join(options.directory, "stack.env"), "utf8"), /PASSWORD='literal\$# value'/);
});

test("identity mismatch fails verification rather than publishing a successful deployment", async () => {
  const { options, artifacts, execute, ports } = await fixture();
  const runtime = nextcloudStackRuntime(options, ports, async (command, args, context) => args[0] === "image" ? "sha256:unexpected" : execute(command, args, context));
  await assert.rejects(runtime.start({}), /image mismatch/);
  assert.equal(artifacts.files.length, 0);
});

test("the stack exposes its owned Compose lifecycle and awaits observers before disposal, including cancellation", async () => {
  const { options, artifacts, calls, execute } = await fixture();
  const phases: string[] = [];
  const observations = recordingPublisher(async (value) => {
    assert.equal(value.resource.project, options.project);
    assert.deepEqual(value.resource.services, ["first"]);
    assert.doesNotMatch(JSON.stringify(value), /private-password|literal\$/);
    if (value.phase === "before-release") {
      assert.ok(!calls.some((call) => call.includes("down")));
      await Promise.resolve();
    }
    phases.push(value.phase);
  });
  const controller = new AbortController();
  const runtime = nextcloudStackRuntime(options, { artifacts, observations }, execute);
  const lease = await runtime.start({ signal: controller.signal });
  controller.abort();
  await lease.release(); await lease.release();
  assert.deepEqual(phases, ["allocated", "before-release"]);
  assert.ok(calls.some((call) => call.includes("down") && call.includes("--volumes")));
  assert.ok(!calls.some((call) => call.includes("logs") || call.includes("tail")), "the resource owner performs no diagnostic capture");
  assert.equal(artifacts.files.length, 1, "only provisioning identity is produced by the stack");
});

test("partial startup failure publishes before-release before compensating its acquisition", async () => {
  const { options, artifacts, calls, execute } = await fixture();
  const phases: string[] = [];
  const observations = recordingPublisher(({ phase }) => {
    assert.ok(!calls.some((call) => call.includes("down")));
    phases.push(phase);
  });
  const runtime = nextcloudStackRuntime(options, { artifacts, observations }, (command, args, context) =>
    args[0] === "image" ? Promise.resolve("sha256:unexpected") : execute(command, args, context));
  await assert.rejects(runtime.start({}), /image mismatch/);
  assert.deepEqual(phases, ["allocated", "before-release"]);
  assert.ok(calls.some((call) => call.includes("down")));
});

test("declared system settings preserve boolean and integer types", async () => {
  const { options, ports, calls, execute } = await fixture();
  const runtime = nextcloudStackRuntime({ ...options, systemConfig: { "fixture.enabled": false, "fixture.limit": 3 } }, ports, execute);
  const lease = await runtime.start({}); await lease.release();
  assert.ok(calls.some((args) => args.includes("fixture.enabled") && args.includes("--type=boolean") && args.includes("--value=false")));
  assert.ok(calls.some((args) => args.includes("fixture.limit") && args.includes("--type=integer") && args.includes("--value=3")));
  assert.throws(() => validateStackOptions({ ...options, systemConfig: { invalid: 0.5 } }), /systemConfig/);
});

test("untrusted source pins and shared service origins are rejected before allocation", async () => {
  const { options } = await fixture();
  assert.throws(() => validateStackOptions({ ...options, build: { repository: "https://example.test/source.git", sha: "main", directory: "/source", dockerfile: "/Dockerfile", apps: [] } }), /exact commit/);
  assert.throws(() => validateStackOptions({ ...options, services: { ...options.services, duplicate: options.services.first } }), /distinct HTTP/);
});

test("rejecting an existing project does not delete its containers or volumes during cleanup", async () => {
  const { options, ports, calls, execute } = await fixture();
  const runtime = nextcloudStackRuntime(options, ports, async (command, args, context) => args.includes("ps") ? "existing-container" : execute(command, args, context));
  await assert.rejects(runtime.start({}), /already has containers/);
  assert.ok(!calls.some((call) => call.includes("down") || call.includes("up")));
});

const head = "f474116f861074297b505fd0f54e39111ae23f45";

/** A fixture whose build comes from a pull request; git answers like a remote whose PR head is `sha`. */
async function pullRequestFixture(version = "36.0.0 dev", sha = head) {
  const base = await fixture();
  const source = join(base.options.directory, "server");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "version.php"), `<?php\n$OC_Version = [36, 0, 0, 1];\n$OC_VersionString = '${version}';\n`);
  const options: StackOptions = { ...base.options, image: "journey/nextcloud", expectedVersion: undefined, build: { repository: "https://example.test/server.git", pullRequest: 66147, directory: source, dockerfile: "/Dockerfile", apps: [] } };
  const execute: StackExecutor = async (command, args, context) => {
    if (command === "git") {
      (base.calls as string[][]).push([command, ...args]);
      if (args[0] === "rev-parse") return args[1] === "--show-toplevel" ? "" : sha;
      return "";
    }
    if (args.at(-1)?.endsWith(".journey-source-sha")) return sha;
    return base.execute(command, args, context);
  };
  return { ...base, options, execute };
}

test("a pull request is resolved to its head commit, which names the image and sets the expected version", async () => {
  const { options, ports, calls, execute } = await pullRequestFixture();
  const runtime = nextcloudStackRuntime(options, ports, async (command, args, context) => args.includes("status") && command === "docker" ? JSON.stringify({ installed: true, versionstring: "36.0.0 dev" }) : execute(command, args, context));
  const lease = await runtime.start({});
  const image = `journey/nextcloud:pr66147-${head.slice(0, 12)}`;
  assert.ok(calls.some((call) => call.join(" ") === "git fetch origin refs/pull/66147/head"), "fetches the pull request ref, not a commit");
  const build = calls.find((call) => call[0] === "docker" && call[1] === "build")!;
  assert.deepEqual(build.slice(build.indexOf("--build-arg"), build.indexOf("--build-arg") + 2), ["--build-arg", `SOURCE_SHA=${head}`]);
  assert.equal(build[build.indexOf("-t") + 1], image);
  assert.match(await readFile(join(options.directory, "stack.env"), "utf8"), new RegExp(`NEXTCLOUD_IMAGE='${image}'`));
  assert.deepEqual(JSON.parse(JSON.stringify(lease.provenance)), { project: "isolated-stack", image, pullRequest: 66147, verifiedAt: (lease.provenance as { verifiedAt: string }).verifiedAt, services: [{ service: "first", version: "36.0.0 dev", imageId: "sha256:actual-image", sourceSha: head, apps: { notifications: "1.0" } }] });
});

test("a pull request built on another Nextcloud is checked against that version, not a pinned one", async () => {
  const { options, ports, execute } = await pullRequestFixture("36.0.0 dev");
  // The installed server reports a different version than the source says it is.
  const runtime = nextcloudStackRuntime(options, ports, async (command, args, context) => args.includes("status") && command === "docker" ? JSON.stringify({ installed: true, versionstring: "34.0.2" }) : execute(command, args, context));
  await assert.rejects(runtime.start({}), /installed version does not match 36\.0\.0 dev/);
});

test("a pull request that does not exist fails naming the ref, before any container is created", async () => {
  const { options, ports, calls, execute } = await pullRequestFixture();
  const runtime = nextcloudStackRuntime({ ...options, build: { ...options.build!, pullRequest: 404 } as StackOptions["build"] }, ports, async (command, args, context) => {
    if (command === "git" && args[0] === "fetch") throw new Error("git fetch failed (128): fatal: couldn't find remote ref refs/pull/404/head");
    return execute(command, args, context);
  });
  await assert.rejects(runtime.start({}), /Cannot fetch refs\/pull\/404\/head from https:\/\/example\.test\/server\.git/);
  assert.ok(!calls.some((call) => call.includes("up") || call[1] === "build"));
});

test("a build takes either a pull request or an exact commit, and a pull request image carries no tag of its own", async () => {
  const { options } = await pullRequestFixture();
  const { pullRequest: _pullRequest, ...build } = options.build as { repository: string; directory: string; dockerfile: string; apps: []; pullRequest: number };
  assert.doesNotThrow(() => validateStackOptions(options));
  assert.throws(() => validateStackOptions({ ...options, build: { ...build, pullRequest: 1, sha: head } as StackOptions["build"] }), /exactly one of sha or pullRequest/);
  assert.throws(() => validateStackOptions({ ...options, build: build as unknown as StackOptions["build"] }), /exactly one of sha or pullRequest/);
  for (const pullRequest of [0, -3, 1.5, Number.NaN]) assert.throws(() => validateStackOptions({ ...options, build: { ...build, pullRequest } as StackOptions["build"] }), /positive pull request number/);
  assert.throws(() => validateStackOptions({ ...options, image: "journey/nextcloud:latest" }), /image must be a repository name/);
  assert.throws(() => validateStackOptions({ ...options, build: undefined }), /expectedVersion is required/);
});

test("a fresh clone is built even though git reports an empty checkout as modified, but a modified existing checkout is refused", async () => {
  const { options, ports, execute } = await pullRequestFixture();
  const git = (toplevel: string): StackExecutor => async (command, args, context) => {
    if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") return toplevel;
    // After `git clone --no-checkout` every tracked file shows as a staged deletion.
    if (command === "git" && args[0] === "status") return "D  version.php";
    return execute(command, args, context);
  };
  const installed = (inner: StackExecutor): StackExecutor => (command, args, context) => command === "docker" && args.includes("status") ? Promise.resolve(JSON.stringify({ installed: true, versionstring: "36.0.0 dev" })) : inner(command, args, context);
  await nextcloudStackRuntime(options, ports, installed(git(""))).start({});
  const reused = await pullRequestFixture();
  await assert.rejects(nextcloudStackRuntime(reused.options, reused.ports, installed(git((reused.options.build as { directory: string }).directory))).start({}), /Refusing to build modified source/);
});
