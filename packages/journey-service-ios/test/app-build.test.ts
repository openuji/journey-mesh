import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { iosAppBuildService, validateIosAppBuild, type IosAppBuildOptions } from "../src/app-build/service.js";
import { journeyMeshPlugin } from "../src/app-build/plugin.js";

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>it.twsweb.Nextcloud</string>
  <key>CFBundleVersion</key><string>42</string>
  <key>CFBundleShortVersionString</key><string>7.3.0</string>
</dict></plist>`;

const baseOptions: IosAppBuildOptions = {
  directory: "",
  scheme: "Nextcloud",
  project: "Nextcloud.xcodeproj",
  configuration: "Debug",
  output: "Build/Products/Debug-iphonesimulator/Nextcloud.app",
  xcodeVersion: "26",
  sourceDirectory: "ios",
  siblingDirectory: "nextcloud-kit",
  arguments: ["-quiet"]
};

const identity = (sha: string, repository = "https://github.com/nextcloud/ios.git") => ({ repository, sourceSha: sha.repeat(40), pullRequest: 4489 });

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "journey-ios-app-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path: string, value = "") => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value); };
  const source = join(root, "checkouts/ios");
  const sibling = join(root, "checkouts/kit");
  const mockPlist = join(root, "fixtures/mock-GoogleService-Info.plist");
  await put(join(source, "Nextcloud.xcodeproj/project.pbxproj"), "// xcodeproj\n");
  await put(join(source, ".git/HEAD"), "ref\n");
  await put(join(sibling, "Package.swift"), "// swift-tools-version:6.0\n");
  await put(mockPlist, "<plist><dict/></plist>");

  const runs: { args: readonly string[]; cwd: string; siblingPresent: boolean; gitCopied: boolean; injectedPresent: boolean }[] = [];
  const dependencies = {
    toolchain: async () => ({
      developerDir: "/Applications/Xcode.app/Contents/Developer",
      xcodeVersion: "26.6",
      xcodeBuild: "17F113",
      swiftVersion: "Apple Swift version 6.2",
      fingerprint: "xcode-tools-v1"
    }),
    async run(_command: string, args: readonly string[], { cwd }: { cwd: string }) {
      const derivedIndex = args.indexOf("-derivedDataPath");
      const derivedData = args[derivedIndex + 1]!;
      runs.push({
        args,
        cwd,
        siblingPresent: await readFile(join(cwd, "../nextcloud-kit/Package.swift"), "utf8").then(() => true, () => false),
        gitCopied: await readFile(join(cwd, ".git/HEAD")).then(() => true, () => false),
        injectedPresent: await readFile(join(cwd, "GoogleService-Info.plist"), "utf8").then(() => true, () => false)
      });
      await put(join(derivedData, baseOptions.output, "Info.plist"), plist);
      await put(join(derivedData, baseOptions.output, "Nextcloud"), `binary built in ${cwd}`);
    },
    log: () => {}
  };
  return {
    root,
    source,
    sibling,
    mockPlist,
    runs,
    dependencies,
    settings: {
      ...baseOptions,
      directory: join(root, ".runtime/ios-app"),
      files: { "GoogleService-Info.plist": mockPlist }
    }
  };
}

test("iOS app build options reject unsafe paths, schemes and arguments", () => {
  assert.doesNotThrow(() => validateIosAppBuild({ ...baseOptions, directory: "/work" }));
  assert.throws(() => validateIosAppBuild({ ...baseOptions, output: "../outside" }), /relative path/);
  assert.throws(() => validateIosAppBuild({ ...baseOptions, project: "A.xcodeproj", workspace: "B.xcworkspace" }), /at most one of project or workspace/);
  assert.throws(() => validateIosAppBuild({ ...baseOptions, siblingDirectory: "../kit" }), /single directory name/);
  assert.throws(() => validateIosAppBuild({ ...baseOptions, arguments: ["-derivedDataPath", "/tmp/x"] }), /may not override managed xcodebuild/);
});

test("the build lays out source, sibling and files, reports app bundle identity, and reuses an unchanged pair", async (t) => {
  const f = await fixture(t);
  const inputs = {
    source: { directory: f.source, identity: identity("a") },
    sibling: { directory: f.sibling, identity: identity("b", "https://github.com/nextcloud/NextcloudKit.git") }
  };
  const lease = await iosAppBuildService(f.settings, f.dependencies, inputs).start({});
  const first = lease.outputs as Record<string, any>;
  assert.equal(f.runs.length, 1);
  assert.ok(f.runs[0]!.args.includes("iphonesimulator"));
  assert.ok(!f.runs[0]!.args.includes("CODE_SIGNING_ALLOWED=NO"));
  assert.equal(f.runs[0]!.siblingPresent, true);
  assert.equal(f.runs[0]!.gitCopied, false);
  assert.equal(f.runs[0]!.injectedPresent, true);
  assert.equal(first.app.bundleId, "it.twsweb.Nextcloud");
  assert.equal(first.app.bundleVersion, "42");
  assert.equal(first.app.bundleShortVersionString, "7.3.0");
  assert.match(first.app.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.identity, { ...identity("a"), version: "7.3.0" });
  const provenance = JSON.stringify(lease.provenance);
  assert.ok(!provenance.includes(f.root), "provenance must not contain working paths");
  assert.match(provenance, /26\.6/);

  const again = (await iosAppBuildService(f.settings, f.dependencies, inputs).start({})).outputs as Record<string, any>;
  assert.equal(f.runs.length, 1, "an unchanged source pair reuses the built .app bundle");
  assert.deepEqual(again.app, first.app);

  await iosAppBuildService(f.settings, f.dependencies, { ...inputs, sibling: { ...inputs.sibling, identity: identity("c") } }).start({});
  assert.equal(f.runs.length, 2, "a new sibling head rebuilds");
});

test("cached builds retain current PR selection, invalidate on toolchain change, and preserve earlier generations", async (t) => {
  const f = await fixture(t);
  const inputs = { source: { directory: f.source, identity: identity("a") }, sibling: { directory: f.sibling, identity: identity("b") } };
  const first = await iosAppBuildService(f.settings, f.dependencies, inputs).start({});
  const changed = { ...inputs, source: { ...inputs.source, identity: { ...inputs.source.identity, pullRequest: 4490 } } };
  const next = await iosAppBuildService(f.settings, f.dependencies, changed).start({});
  assert.equal((next.outputs.identity as any).pullRequest, 4490);
  assert.equal((next.provenance as any).build.source.pullRequest, 4489);
  assert.equal((next.provenance as any).cache.reused, true);
  assert.equal(f.runs.length, 1);

  await iosAppBuildService(f.settings, {
    ...f.dependencies,
    toolchain: async () => ({ ...await f.dependencies.toolchain(), fingerprint: "changed" })
  }, changed).start({});
  assert.equal(f.runs.length, 2);
  assert.equal(await readFile(join((first.outputs.app as any).path, "Nextcloud"), "utf8").then(() => true), true);
});

test("the plugin declares source and optional sibling inputs and outputs app + identity", () => {
  assert.deepEqual(Object.keys(journeyMeshPlugin.inputs ?? {}), ["source"]);
  assert.deepEqual(Object.keys(journeyMeshPlugin.optionalInputs ?? {}), ["sibling"]);
  assert.deepEqual(Object.keys(journeyMeshPlugin.outputs ?? {}), ["app", "identity"]);
});
