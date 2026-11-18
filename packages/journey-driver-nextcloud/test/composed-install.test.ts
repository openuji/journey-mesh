import assert from "node:assert/strict";
import { test } from "node:test";
import { access, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildService } from "../src/runtime/build.js";
import { appInstall } from "../src/runtime/app-install.js";
import type { AppBuild, ManagedStack } from "../src/runtime/contracts.js";

test("app recipe builds the supplied source without modifying it and carries its identity into verified installation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "composed-app-"));
  const source = join(directory, "source"); await mkdir(join(source, "appinfo"), { recursive: true });
  await writeFile(join(source, "appinfo/info.xml"), "<info><id>example</id><version>1.2.3</version></info>");
  await symlink("appinfo", join(source, "relative-link"));
  const image = `example@sha256:${"a".repeat(64)}`;
  const identity = { repository: "https://example.test/example.git", pullRequest: 12, sourceSha: "b".repeat(40) };
  let recipe = "";
  const build = buildService({ directory: join(directory, "build"), image: "journey/app", nodeImage: image, composerImage: image }, false,
    async (_command, args) => {
      recipe = await readFile(args[2], "utf8");
      assert.equal(await readlink(join(dirname(args[2]), "relative-link")), "appinfo");
      return "";
    });
  const result = await build.up({ inputs: { source: { directory: source, identity } } });
  const app = result!.app as AppBuild;
  assert.equal(app.id, "example"); assert.equal(app.identity.version, "1.2.3");
  assert.equal(app.identity.sourceSha, identity.sourceSha);
  assert.ok(recipe.includes("npm ci") && recipe.includes("composer install"));
  assert.ok(!recipe.includes("example.git") && !recipe.includes("pullRequest"));
  await assert.rejects(access(join(source, ".journey-source-sha")));
  const stack: ManagedStack = { project: "isolated", composeFiles: ["/compose.yaml"], envFile: "/stack.env", services: ["nextcloud"] };
  const calls: string[][] = [];
  const install = appInstall({ directory: join(directory, "install"), services: ["nextcloud"], enable: true }, async (_command, args) => {
    calls.push([...args]);
    if (args.includes("cat")) return identity.sourceSha;
    if (args.includes("app:list")) return JSON.stringify({ enabled: { example: "1.2.3" } });
    return "";
  });
  const installed = await install.up({ inputs: { app, stack } });
  assert.deepEqual(installed!.identity, app.identity);
  const copy = calls.findIndex((call) => call[0] === "compose" && call.includes("cp"));
  const enable = calls.findIndex((call) => call.includes("app:enable"));
  assert.ok(copy >= 0 && enable > copy);
  assert.ok(calls.some((call) => call[0] === "rm"));
});
test("installation never reports success on a source mismatch and still cleans up its export container", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bad-install-"));
  const calls: string[][] = [];
  const app: AppBuild = { id: "example", image: "image:built", identity: { repository: "https://example.test/repo.git", sourceSha: "a".repeat(40), version: "1" } };
  const installer = appInstall({ directory, services: ["cloud"], enable: true }, async (_command, args) => { calls.push([...args]); return args.includes("cat") ? "b".repeat(40) : ""; });
  await assert.rejects(installer.up({ inputs: { app, stack: { project: "owned", composeFiles: [], envFile: "/env", services: ["cloud"] } } }), /source mismatch/);
  assert.ok(calls.some((call) => call[0] === "rm"));
  assert.ok(!calls.some((call) => call.includes("app:enable")));
  assert.equal(installer.provenance!(), undefined);
});
