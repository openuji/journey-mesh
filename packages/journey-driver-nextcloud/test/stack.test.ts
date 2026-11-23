import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileEvidenceStore } from "@openuji/journey-run-record/node";
import { executeStackCommand, nextcloudStackRuntime, validateStackOptions, type StackOptions, type StackExecutor } from "../src/runtime/stack.js";

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
  const execute: StackExecutor = async (command, args) => {
    (calls as string[][]).push([command, ...args]);
    if (args.includes("status")) return JSON.stringify({ installed: true, versionstring: "34.0.2" });
    if (args.includes("app:list")) return JSON.stringify({ enabled: { notifications: "1.0" } });
    if (args.includes("inspect")) return "sha256:actual-image";
    if (args.includes("config:system:get")) return args.at(-1) === "logfile" ? "" : "/var/www/html/data";
    if (args.includes("tail")) return '{"message":"Nextcloud application diagnostic"}';
    if (args.includes("logs")) return "Apache diagnostic";
    return "";
  };
  return { options, artifacts, calls, execute };
}

test("Nextcloud lifecycle owns provisioning, verifies image identity, and publishes credential-free provenance", async () => {
  const { options, artifacts, calls, execute } = await fixture();
  const runtime = nextcloudStackRuntime(options, artifacts, execute);
  assert.equal(calls.length, 0);
  const lease = await runtime.start({}); await lease.release();
  assert.ok(calls.every((call) => call[0] !== "docker" || call[1] === "image" || call[1] === "inspect" || call.includes(options.project) || call.includes(`label=com.docker.compose.project=${options.project}`)));
  assert.ok(calls.some((call) => call.includes("allow_local_remote_servers")));
  assert.ok(calls.some((call) => call.includes("--volumes")));
  const identity = JSON.stringify(lease.provenance);
  assert.match(identity, /sha256:actual-image/);
  assert.doesNotMatch(identity, /private-password|literal\$/);
  assert.equal(artifacts.files.length, 3);
  assert.match(await readFile(join(options.directory, "stack.env"), "utf8"), /PASSWORD='literal\$# value'/);
});

test("identity mismatch fails verification rather than publishing a successful deployment", async () => {
  const { options, artifacts, execute } = await fixture();
  const runtime = nextcloudStackRuntime(options, artifacts, async (command, args, context) => args[0] === "image" ? "sha256:unexpected" : execute(command, args, context));
  await assert.rejects(runtime.start({}), /image mismatch/);
  assert.ok(!artifacts.files.some((file) => file.name.endsWith(".identity.json")));
  assert.equal(artifacts.files.length, 2, "startup failure retains logs before cleanup");
});

test("stack release captures application and container logs before deleting volumes, even after cancellation", async () => {
  const { options, artifacts, calls, execute } = await fixture();
  const controller = new AbortController();
  const runtime = nextcloudStackRuntime(options, artifacts, async (command, args, context) => {
    context.signal?.throwIfAborted();
    return execute(command, args, context);
  });
  const lease = await runtime.start({ signal: controller.signal });
  controller.abort();
  await lease.release();
  const logs = calls.findIndex((call) => call.includes("logs"));
  const application = calls.findIndex((call) => call.includes("tail"));
  const down = calls.findIndex((call) => call.includes("down"));
  assert.ok(logs > 0 && application > logs && down > application);
  assert.equal(await readFile(join(options.directory, "evidence", `${options.project}.compose.log`), "utf8"), "Apache diagnostic");
  assert.match(await readFile(join(options.directory, "evidence", `${options.project}.first.nextcloud.log`), "utf8"), /Nextcloud application diagnostic/);
  const before = calls.length;
  await lease.release();
  assert.equal(calls.length, before, "a second release cannot capture another acquisition's logs");
});

test("failed diagnostic commands remain visible without preventing stack cleanup", async () => {
  const { options, artifacts, calls, execute } = await fixture();
  const lease = await nextcloudStackRuntime(options, artifacts, async (command, args, context) => {
    if (args.includes("logs") || args.includes("tail")) throw new Error("log unavailable");
    return execute(command, args, context);
  }).start({});
  await lease.release();
  assert.ok(calls.some((call) => call.includes("down") && call.includes("--volumes")));
  assert.match(await readFile(join(options.directory, "evidence", `${options.project}.first.nextcloud.log`), "utf8"), /Diagnostic capture failed: log unavailable/);
});

test("declared system settings preserve boolean and integer types", async () => {
  const { options, artifacts, calls, execute } = await fixture();
  const runtime = nextcloudStackRuntime({ ...options, systemConfig: { "fixture.enabled": false, "fixture.limit": 3 } }, artifacts, execute);
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
  const { options, artifacts, calls, execute } = await fixture();
  const runtime = nextcloudStackRuntime(options, artifacts, async (command, args, context) => args.includes("ps") ? "existing-container" : execute(command, args, context));
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
  const { options, artifacts, calls, execute } = await pullRequestFixture();
  const runtime = nextcloudStackRuntime(options, artifacts, async (command, args, context) => args.includes("status") && command === "docker" ? JSON.stringify({ installed: true, versionstring: "36.0.0 dev" }) : execute(command, args, context));
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
  const { options, artifacts, execute } = await pullRequestFixture("36.0.0 dev");
  // The installed server reports a different version than the source says it is.
  const runtime = nextcloudStackRuntime(options, artifacts, async (command, args, context) => args.includes("status") && command === "docker" ? JSON.stringify({ installed: true, versionstring: "34.0.2" }) : execute(command, args, context));
  await assert.rejects(runtime.start({}), /installed version does not match 36\.0\.0 dev/);
});

test("a pull request that does not exist fails naming the ref, before any container is created", async () => {
  const { options, artifacts, calls, execute } = await pullRequestFixture();
  const runtime = nextcloudStackRuntime({ ...options, build: { ...options.build!, pullRequest: 404 } as StackOptions["build"] }, artifacts, async (command, args, context) => {
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
  const { options, artifacts, execute } = await pullRequestFixture();
  const git = (toplevel: string): StackExecutor => async (command, args, context) => {
    if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") return toplevel;
    // After `git clone --no-checkout` every tracked file shows as a staged deletion.
    if (command === "git" && args[0] === "status") return "D  version.php";
    return execute(command, args, context);
  };
  const installed = (inner: StackExecutor): StackExecutor => (command, args, context) => command === "docker" && args.includes("status") ? Promise.resolve(JSON.stringify({ installed: true, versionstring: "36.0.0 dev" })) : inner(command, args, context);
  await nextcloudStackRuntime(options, artifacts, installed(git(""))).start({});
  const reused = await pullRequestFixture();
  await assert.rejects(nextcloudStackRuntime(reused.options, reused.artifacts, installed(git((reused.options.build as { directory: string }).directory))).start({}), /Refusing to build modified source/);
});
