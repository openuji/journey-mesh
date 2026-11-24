import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { apkBuildService, findJdk, parseBadging, validateApkBuild, type ApkBuildOptions } from "../src/runtime/apk-build.js";
import { journeyMeshPlugin } from "../src/runtime/apk-build-plugin.js";

const options: ApkBuildOptions = {
  directory: "", task: "assembleGenericDebug", output: "app/build/outputs/apk/generic/debug",
  javaVersion: 21, toolchains: [17], sourceDirectory: "android", siblingDirectory: "android-library", arguments: ["-Dorg.gradle.jvmargs=-Xmx4g"]
};
const identity = (sha: string, repository = "https://github.com/example/app.git") => ({ repository, sourceSha: sha.repeat(40), pullRequest: 7 });
const badging = "package: name='com.example.client' versionCode='350020000' versionName='35.2.0 Alpha 51' platformBuildVersionName='16'\nsdkVersion:'28'\n";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "journey-apk-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path: string, value = "") => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value); };
  const source = join(root, "checkouts/app"); const sibling = join(root, "checkouts/library");
  await put(join(source, "gradlew"), "#!/bin/sh\n");
  await put(join(source, "gradle/wrapper/gradle-wrapper.properties"), "distributionUrl=https\\://services.gradle.org/distributions/gradle-9.9.1-bin.zip\n");
  await put(join(source, ".git/HEAD"), "ref\n");
  await put(join(sibling, "settings.gradle"), "");
  const runs: { args: readonly string[]; cwd: string; siblingPresent: boolean; gitCopied: boolean }[] = [];
  const dependencies = {
    toolchain: async () => ({ sdk: "/sdk", javaHome: "/jdk", javaVersion: "21.0.5", aapt2: "/sdk/build-tools/37.0.0/aapt2", apksigner: "/sdk/apksigner", fingerprint: "tools-v1",
      installations: [{ major: 17, home: "/jdk17", version: "17.0.13" }] }),
    async run(_command: string, args: readonly string[], { cwd, env }: { cwd: string; env: NodeJS.ProcessEnv }) {
      runs.push({ args, cwd, siblingPresent: await readFile(join(cwd, "../android-library/settings.gradle"), "utf8").then(() => true, () => false),
        gitCopied: await readFile(join(cwd, ".git/HEAD")).then(() => true, () => false) });
      await put(join(env.JOURNEY_GRADLE_OBSERVATIONS!, "runtime.json"), JSON.stringify({ gradle: "9.9.1", jvm: { version: "21.0.5", vendor: "test" } }));
      await put(join(cwd, options.output, "app-generic-debug.apk"), `apk built in ${cwd}`);
    },
    signed: async () => {}, badging: async () => badging, log: () => {}
  };
  return { root, source, sibling, runs, dependencies, settings: { ...options, directory: join(root, ".runtime/apk") } };
}

test("APK build options reject unsafe paths, tasks and arguments", () => {
  assert.doesNotThrow(() => validateApkBuild({ ...options, directory: "/work" }));
  assert.throws(() => validateApkBuild({ ...options, output: "../outside" }), /relative path inside the checkout/);
  assert.throws(() => validateApkBuild({ ...options, task: "assemble; rm -rf" }), /Gradle task/);
  assert.throws(() => validateApkBuild({ ...options, siblingDirectory: "../library" }), /single directory name/);
  assert.throws(() => validateApkBuild({ ...options, arguments: ["clean"] }), /only add Gradle options/);
  assert.throws(() => validateApkBuild({ ...options, javaVersion: Number.NaN }), /JDK major/);
  assert.throws(() => validateApkBuild({ ...options, toolchains: [1.5] }), /JDK major/);
});

test("badging yields the installed package identity", () => {
  assert.deepEqual(parseBadging(badging), { package: "com.example.client", versionCode: 350020000, versionName: "35.2.0 Alpha 51" });
  assert.throws(() => parseBadging("sdkVersion:'28'"), /Cannot read package/);
});

test("the build lays out source and sibling, reports APK identity, and reuses an unchanged pair", async (t) => {
  const f = await fixture(t);
  const inputs = { source: { directory: f.source, identity: identity("a") }, sibling: { directory: f.sibling, identity: identity("b", "https://github.com/example/library.git") } };
  const lease = await apkBuildService(f.settings, f.dependencies, inputs).start({});
  const first = lease.outputs as Record<string, any>;
  assert.equal(f.runs.length, 1);
  assert.ok(f.runs[0]!.args.includes("--no-configuration-cache"));
  assert.ok(f.runs[0]!.args.includes("--init-script"));
  assert.ok(f.runs[0]!.args.includes("-Porg.gradle.java.installations.paths=/jdk,/jdk17"));
  assert.equal(f.runs[0]!.siblingPresent, true);
  assert.equal(f.runs[0]!.gitCopied, false);
  assert.equal(first.apk.package, "com.example.client");
  assert.equal(first.apk.versionCode, 350020000);
  assert.match(first.apk.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.identity, { ...identity("a"), version: "35.2.0 Alpha 51" });
  const provenance = JSON.stringify(lease.provenance);
  assert.ok(!provenance.includes(f.root), "provenance must not contain working paths");
  assert.match(provenance, /9\.9\.1/);
  assert.match(provenance, /"sibling"/);
  assert.match(provenance, /"toolchains":\["17\.0\.13"\]/);

  const again = (await apkBuildService(f.settings, f.dependencies, inputs).start({})).outputs as Record<string, any>;
  assert.equal(f.runs.length, 1, "an unchanged source pair reuses the built APK");
  assert.deepEqual(again.apk, first.apk);

  await apkBuildService(f.settings, f.dependencies, { ...inputs, sibling: { ...inputs.sibling, identity: identity("c") } }).start({});
  assert.equal(f.runs.length, 2, "a new sibling head rebuilds");
});

test("cached builds retain current PR selection and invalidate when resolved tools change", async (t) => {
  const f = await fixture(t);
  const inputs = { source: { directory: f.source, identity: identity("a") }, sibling: { directory: f.sibling, identity: identity("b") } };
  const first = await apkBuildService(f.settings, f.dependencies, inputs).start({});
  const changed = { ...inputs, source: { ...inputs.source, identity: { ...inputs.source.identity, pullRequest: 8 } } };
  const next = await apkBuildService(f.settings, f.dependencies, changed).start({});
  assert.equal((next.outputs.identity as any).pullRequest, 8);
  assert.equal((next.provenance as any).build.source.pullRequest, 7);
  assert.equal((next.provenance as any).cache.reused, true);
  assert.deepEqual(next.outputs.apk, first.outputs.apk);
  assert.equal(f.runs.length, 1);
  await apkBuildService(f.settings, { ...f.dependencies, toolchain: async () => ({ ...await f.dependencies.toolchain(), fingerprint: "changed" }) }, changed).start({});
  assert.equal(f.runs.length, 2);
  assert.equal(await readFile((first.outputs.apk as any).path, "utf8").then(() => true), true, "rebuilding preserves an APK held by an earlier lease");
});

test("a sibling checkout requires siblingDirectory and vice versa", async (t) => {
  const f = await fixture(t);
  await assert.rejects(apkBuildService(f.settings, f.dependencies, { source: { directory: f.source, identity: identity("a") } }).start({}), /configured together/);
  const { siblingDirectory: _, ...withoutSibling } = f.settings;
  await assert.rejects(apkBuildService(withoutSibling, f.dependencies, { source: { directory: f.source, identity: identity("a") }, sibling: { directory: f.sibling, identity: identity("b") } }).start({}), /configured together/);
});

test("the plugin declares the sibling as an optional input", () => {
  assert.deepEqual(Object.keys(journeyMeshPlugin.inputs ?? {}), ["source"]);
  assert.deepEqual(Object.keys(journeyMeshPlugin.optionalInputs ?? {}), ["sibling"]);
  assert.deepEqual(Object.keys(journeyMeshPlugin.outputs ?? {}), ["apk", "identity"]);
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
  const { runGradle } = await import("../src/runtime/apk-build.js");
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

test("a corrupt APK rebuilds in a new generation and concurrent builds preserve both outputs", async (t) => {
  const f = await fixture(t);
  const inputs = { source: { directory: f.source, identity: identity("a") }, sibling: { directory: f.sibling, identity: identity("b") } };
  const first = await apkBuildService(f.settings, f.dependencies, inputs).start({});
  const oldPath = (first.outputs.apk as any).path;
  await writeFile(oldPath, "corrupted artifact");
  const second = await apkBuildService(f.settings, f.dependencies, inputs).start({});
  assert.notEqual((second.outputs.apk as any).path, oldPath);
  assert.equal(await readFile(oldPath, "utf8"), "corrupted artifact", "the earlier path was never removed or replaced");
  assert.equal(f.runs.length, 2);
  const changed = { ...inputs, source: { ...inputs.source, identity: identity("c") } };
  const [left, right] = await Promise.all([apkBuildService(f.settings, f.dependencies, changed).start({}), apkBuildService(f.settings, f.dependencies, changed).start({})]);
  for (const lease of [left, right]) assert.ok((await readFile((lease.outputs.apk as any).path)).length);
  assert.notEqual((left.outputs.apk as any).path, (right.outputs.apk as any).path);
  const cached = await apkBuildService(f.settings, f.dependencies, changed).start({});
  assert.equal((cached.provenance as any).cache.reused, true);
});
