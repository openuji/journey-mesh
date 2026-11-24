import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObservationPublisher } from "@openuji/journey-plugin";
import type { ComposeExecutor } from "@openuji/journey-service-docker/compose";
import type { MoodleImage } from "../src/services/contracts.js";
import { moodleStackRuntime, validateMoodleStackOptions, type MoodleStackOptions } from "../src/services/stack/stack.js";

const tourJs = "public/admin/tool/usertours/amd/build/tour.min.js";
const image: MoodleImage = { image: "journey/moodle:journey-0123456789abcdef", files: { [tourJs]: "f".repeat(64) },
  identity: { repository: "https://github.com/zavalit/moodle.git", sourceSha: "b5b1675c7967fea1df5f1bd4961710c33a74ea43", version: "6.0dev (Build: 20261021)" } };

type Overrides = Partial<{ entrypointReads: number; release: string; sha: string; checksum: string; imageId: string; dropConfig: boolean }>;
async function fixture(overrides: Overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "moodle-stack-"));
  const options: MoodleStackOptions = {
    project: "moodle-tour", composeFiles: ["/deployment/compose.yaml"], directory, environment: { POSTGRES_PASSWORD: "db-secret" }, service: "moodle",
    baseURL: "http://localhost:18090", site: { fullname: "Journey Mesh", shortname: "mesh" }, admin: { username: "admin", password: "Admin-secret-1", email: "admin@example.test" },
    database: { host: "db", name: "moodle", user: "moodle", password: "db-secret" }, config: { theme: "boost" }
  };
  const calls: string[][] = [];
  const phases: string[] = [];
  const config = new Map<string, string>();
  let cmdlineReads = 0;
  let up = false;
  const execute: ComposeExecutor = async (command, args) => {
    calls.push([command, ...args]);
    if (args.at(-1) === "/proc/1/cmdline") return ++cmdlineReads <= (overrides.entrypointReads ?? 0) ? "bash\0/usr/local/bin/moodle-docker-php-entrypoint\0apache2-foreground" : "apache2\0-DFOREGROUND";
    const cfg = args.indexOf("admin/cli/cfg.php");
    if (cfg >= 0) {
      const name = args[cfg + 1]!.slice("--name=".length);
      const set = args[cfg + 2];
      if (set?.startsWith("--set=")) { if (!overrides.dropConfig) config.set(name, set.slice("--set=".length)); return ""; }
      return name === "release" ? overrides.release ?? image.identity.version ?? "" : config.get(name) ?? "";
    }
    if (args.at(-1)?.endsWith(".journey-source-sha")) return `${overrides.sha ?? image.identity.sourceSha}\n`;
    if (args.includes("sha256sum")) return `${overrides.checksum ?? image.files[tourJs]}  /var/www/html/${tourJs}\n`;
    if (args.includes("up")) { up = true; return ""; }
    if (args.includes("ps")) return up ? "container-1" : "";
    if (args[0] === "inspect") return overrides.imageId ?? "sha256:built";
    if (args[0] === "image") return "sha256:built";
    return "";
  };
  const files: unknown[] = [];
  const artifacts = { files, async write(file: unknown) { files.push(file); return file; } } as never;
  const observations: ObservationPublisher = { async publish(_topic, value) { phases.push((value as { phase: string }).phase); } };
  return { options, calls, phases, config, execute, files, ports: { artifacts, observations }, directory };
}
const index = (calls: string[][], predicate: (call: string[]) => boolean) => calls.findIndex(predicate);

test("a site is installed from the built image, configured, verified, and released with its project", async () => {
  const { options, calls, phases, config, execute, files, ports, directory } = await fixture();
  const lease = await moodleStackRuntime(options, image, ports, execute).start({});
  const install = calls.find((call) => call.includes("admin/cli/install.php"))!;
  assert.ok(install.includes("--wwwroot=http://localhost:18090") && install.includes("--dbtype=pgsql") && install.includes("--adminuser=admin") && install.includes("--non-interactive"));
  assert.deepEqual(install.slice(install.indexOf("exec"), install.indexOf("php")), ["exec", "-T", "-u", "www-data", "-w", "/var/www/html", "moodle"]);
  assert.ok(index(calls, (call) => call.at(-1) === "/proc/1/cmdline") < index(calls, (call) => call.includes("admin/cli/install.php")), "installs only after the entrypoint");
  assert.equal(config.get("theme"), "boost");
  assert.deepEqual(lease.outputs, { stack: { project: "moodle-tour", composeFiles: ["/deployment/compose.yaml"], envFile: join(directory, "stack.env"), services: ["moodle"] }, identity: image.identity });
  assert.match(await readFile(join(directory, "stack.env"), "utf8"), /MOODLE_IMAGE='journey\/moodle:journey-0123456789abcdef'/);
  assert.doesNotMatch(JSON.stringify(lease.provenance), /secret/, "provenance holds no credentials");
  assert.equal(files.length, 1);
  await lease.release();
  assert.deepEqual(phases, ["allocated", "before-release"]);
  assert.ok(calls.at(-1)!.includes("down") && calls.at(-1)!.includes("--volumes"));
});

test("installation waits until the image's entrypoint has started Apache", async () => {
  const { options, calls, execute, ports } = await fixture({ entrypointReads: 1 });
  const lease = await moodleStackRuntime(options, image, ports, execute).start({}); await lease.release();
  assert.equal(calls.filter((call) => call.at(-1) === "/proc/1/cmdline").length, 2);
});

for (const [scenario, overrides, message] of [
  ["release", { release: "5.1 (Build: 20251006)" }, /installed release 5.1 \(Build: 20251006\) does not match the built source 6\.0dev/],
  ["source", { sha: "0".repeat(40) }, /installed source SHA mismatch/],
  ["file", { checksum: "0".repeat(64) }, /public\/admin\/tool\/usertours\/amd\/build\/tour\.min\.js differs from the built source/],
  ["image", { imageId: "sha256:other" }, /installed image mismatch/],
  ["config", { dropConfig: true }, /config theme is , not boost/]
] as const) {
  test(`a mismatched ${scenario} fails startup and releases what was started`, async () => {
    const { options, calls, phases, execute, ports } = await fixture(overrides);
    await assert.rejects(moodleStackRuntime(options, image, ports, execute).start({}), message);
    assert.deepEqual(phases, ["allocated", "before-release"]);
    assert.ok(calls.some((call) => call.includes("down")));
  });
}

test("cancellation while the entrypoint runs stops startup and releases the project", async () => {
  const { options, calls, execute, ports } = await fixture({ entrypointReads: Number.POSITIVE_INFINITY });
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("cancelled")), 50);
  await assert.rejects(moodleStackRuntime(options, image, ports, execute).start({ signal: controller.signal }), /cancelled/);
  assert.ok(!calls.some((call) => call.includes("admin/cli/install.php")));
  assert.ok(calls.some((call) => call.includes("down")));
});

test("options are validated before anything is allocated", async () => {
  const { options } = await fixture();
  assert.throws(() => validateMoodleStackOptions({ ...options, baseURL: "ftp://localhost" }), /HTTP URL/);
  assert.throws(() => validateMoodleStackOptions({ ...options, admin: { ...options.admin, username: "Admin" } }), /lowercase username/);
  assert.throws(() => validateMoodleStackOptions({ ...options, config: { "Theme!": "boost" } }), /Invalid config entry/);
  assert.throws(() => validateMoodleStackOptions({ ...options, project: "Moodle Tour" }), /Invalid Compose project name/);
});
