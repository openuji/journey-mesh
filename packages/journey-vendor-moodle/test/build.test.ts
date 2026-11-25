import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { MoodleImage } from "../src/services/contracts.js";
import { moodleBuildService, moodleRelease, validateMoodleBuild, type MoodleBuildOptions } from "../src/services/build/build.js";

const sha = "b5b1675c7967fea1df5f1bd4961710c33a74ea43";
const digest = (name: string) => `${name}@sha256:${"a".repeat(64)}`;
async function checkout(t: TestContext, layout: "public" | "root" = "public") {
  const root = await mkdtemp(join(tmpdir(), "moodle-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "moodle");
  const put = async (path: string, text: string) => { await mkdir(dirname(join(source, path)), { recursive: true }); await writeFile(join(source, path), text); };
  await put(layout === "public" ? "public/version.php" : "version.php", "<?php\n$version  = 2026102100.00;\n$release  = '6.0dev (Build: 20261021)';\n");
  await put("public/admin/tool/usertours/amd/build/tour.min.js", "tour-js");
  await put(".git/HEAD", "ref\n");
  await put("composer.lock", "{}");
  const options: MoodleBuildOptions = { directory: join(root, "builds"), image: "journey/moodle", runtimeImage: digest("moodlehq/moodle-php-apache"), composerImage: digest("composer"),
    verifyFiles: ["public/admin/tool/usertours/amd/build/tour.min.js"] };
  return { root, source, options, inputs: { source: { directory: source, identity: { repository: "https://github.com/zavalit/moodle.git", sourceSha: sha } } } };
}

test("the build copies the checkout, records the release and file checksums, and leaves the source untouched", async (t) => {
  const { source, options, inputs } = await checkout(t);
  const before = (await readdir(source, { recursive: true })).sort();
  const builds: { args: readonly string[]; recipe: string; context: string[]; marker: string }[] = [];
  const run = async (command: string, args: readonly string[]) => {
    assert.equal(command, "docker");
    const context = args.at(-1)!;
    builds.push({ args, recipe: await readFile(join(context, "Dockerfile.journey"), "utf8"), context: (await readdir(context)).sort(), marker: await readFile(join(context, ".journey-source-sha"), "utf8") });
    return "";
  };
  const lease = await moodleBuildService(options, run, inputs).start({});
  const image = lease.outputs.image as MoodleImage;
  assert.match(image.image, /^journey\/moodle:journey-[a-f0-9]{16}$/);
  assert.deepEqual(image.identity, { repository: "https://github.com/zavalit/moodle.git", sourceSha: sha, version: "6.0dev (Build: 20261021)" });
  assert.deepEqual(image.files, { "public/admin/tool/usertours/amd/build/tour.min.js": createHash("sha256").update("tour-js").digest("hex") });
  const [build] = builds;
  assert.deepEqual(build!.args.slice(0, 2), ["build", "-f"]);
  assert.equal(build!.args[build!.args.indexOf("-t") + 1], image.image);
  assert.ok(!build!.context.includes(".git"), "the build context excludes the repository");
  assert.equal(build!.marker, `${sha}\n`);
  assert.match(build!.recipe, /^FROM moodlehq\/moodle-php-apache@sha256:a{64}\n/);
  assert.match(build!.recipe, /composer install --no-dev --no-interaction --prefer-dist --classmap-authoritative/);
  assert.doesNotMatch(build!.recipe, /npm/, "compiled JavaScript is taken as committed");
  assert.deepEqual((await readdir(source, { recursive: true })).sort(), before, "the checkout is not modified");
  assert.deepEqual(await readdir(options.directory), [], "the build context is removed");
  // The same source and recipe give the same tag.
  const again = await moodleBuildService(options, async () => "", inputs).start({});
  assert.equal((again.outputs.image as MoodleImage).image, image.image);
});

test("both source layouts are recognized, and other checkouts are refused", async (t) => {
  assert.equal(await moodleRelease((await checkout(t, "root")).source), "6.0dev (Build: 20261021)");
  const empty = await mkdtemp(join(tmpdir(), "not-moodle-"));
  t.after(() => rm(empty, { recursive: true, force: true }));
  await assert.rejects(moodleRelease(empty), /no version.php/);
});

test("images are pinned by digest and verified files stay inside the source", async (t) => {
  const { options } = await checkout(t);
  assert.throws(() => validateMoodleBuild({ ...options, runtimeImage: "moodlehq/moodle-php-apache:8.3" }), /pinned by digest/);
  assert.throws(() => validateMoodleBuild({ ...options, image: "journey/moodle:latest" }), /untagged image repository/);
  for (const path of ["/etc/passwd", "../outside.js", "public/../../x"]) assert.throws(() => validateMoodleBuild({ ...options, verifyFiles: [path] }), /relative path inside the source/);
});
