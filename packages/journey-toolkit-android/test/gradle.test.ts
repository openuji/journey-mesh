import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findJdk, parseBadging, runGradle } from "../src/index.js";

const badging = "package: name='com.example.client' versionCode='350020000' versionName='35.2.0 Alpha 51' platformBuildVersionName='16'\nsdkVersion:'28'\n";

test("badging yields the installed package identity", () => {
  assert.deepEqual(parseBadging(badging), { package: "com.example.client", versionCode: 350020000, versionName: "35.2.0 Alpha 51" });
  assert.throws(() => parseBadging("sdkVersion:'28'"), /Cannot read package/);
});


test("further JDKs come from setup-java style variables and must match their major", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "journey-jdk-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const jdk = async (name: string, version: string) => {
    const home = join(root, name);
    await mkdir(join(home, "bin"), { recursive: true });
    await writeFile(join(home, "bin/java"), `#!/bin/sh\necho 'openjdk version "${version}" 2025-01-01' >&2\n`, { mode: 0o755 });
    return home;
  };
  const seventeen = await jdk("jdk17", "17.0.13");
  const wrong = await jdk("jdk21", "21.0.5");
  assert.deepEqual(await findJdk(17, { JAVA_HOME_17_ARM64: seventeen }, "linux"), { major: 17, home: seventeen, version: "17.0.13" });
  await assert.rejects(findJdk(17, { JAVA_HOME_17_X64: wrong }, "linux"), /No JDK 17 found/);
  await assert.rejects(findJdk(17, {}, "linux"), /JAVA_HOME_17_X64/);
});


test("Gradle cancellation kills a process group that ignores SIGTERM", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gradle-cancellation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = join(root, "ignore-term.cjs"), logPath = join(root, "gradle.log");
  await writeFile(script, `process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 100);`);
  const controller = new AbortController();
  const running = runGradle(process.execPath, [script], { cwd: root, env: process.env, signal: controller.signal, logPath });
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await readFile(logPath, "utf8").catch(() => "")).includes("ready")) break;
    await new Promise((done) => setTimeout(done, 10));
  }
  assert.match(await readFile(logPath, "utf8"), /ready/);
  const start = Date.now(); controller.abort(new Error("test cancellation"));
  await assert.rejects(running, /test cancellation/);
  assert.ok(Date.now() - start < 12000, "TERM and KILL have bounded waits");
});
