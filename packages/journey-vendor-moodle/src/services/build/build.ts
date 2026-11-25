import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, normalize, resolve } from "node:path";
import { startedService, sourceIdentity, type JourneyService, type SourceCheckout } from "@openuji/journey-plugin";
import { execute, type Command } from "@openuji/journey-service-git";
import type { MoodleImage } from "../contracts.js";

export type MoodleBuildOptions = Readonly<{
  /** Where temporary build contexts are created. */
  directory: string;
  /** Untagged image repository; the tag is derived from the source SHA and the recipe. */
  image: string;
  /** `moodlehq/moodle-php-apache` for the source's PHP version (≥ 8.3 for Moodle 6.0), pinned by digest. */
  runtimeImage: string;
  /** Provides the `composer` binary, pinned by digest. */
  composerImage: string;
  /** Source-relative files whose sha256 the image output records, so a stack can verify it serves those bytes. */
  verifyFiles: readonly string[];
}>;

const pinned = /^[a-z0-9][a-z0-9._/:-]*@sha256:[a-f0-9]{64}$/;
export function validateMoodleBuild(options: MoodleBuildOptions): void {
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(options.image)) throw new Error("image must be an untagged image repository");
  if (!pinned.test(options.runtimeImage) || !pinned.test(options.composerImage)) throw new Error("runtimeImage and composerImage must be pinned by digest");
  for (const path of options.verifyFiles) {
    if (!path || isAbsolute(path) || normalize(path) !== path || path.startsWith("..")) throw new Error(`verifyFiles entry ${path} must be a relative path inside the source`);
  }
}

/**
 * The human-readable `$release` of a source checkout. Moodle 5.1 moved the web root to `public/`, so its
 * `version.php` lives there; older sources keep it at the root.
 */
export async function moodleRelease(directory: string): Promise<string> {
  for (const path of ["public/version.php", "version.php"]) {
    const text = await readFile(join(directory, path), "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const release = /\$release\s*=\s*'([^']+)'/.exec(text)?.[1];
    if (!release) throw new Error(`Cannot read $release from ${path}`);
    return release;
  }
  throw new Error("The source has no version.php; is it a Moodle checkout?");
}

/**
 * Builds a runnable Moodle image from a source checkout. The checkout itself is never modified: the build
 * works on an isolated copy. Dependencies come from the committed `composer.lock`; compiled JavaScript is
 * taken as committed, so the image runs exactly the source's assets.
 */
export function moodleBuildService(options: MoodleBuildOptions, run: Command = execute, inputs: Readonly<Record<string, unknown>> = {}): JourneyService {
  options = structuredClone(options);
  validateMoodleBuild(options);
  return {
    name: "moodle-build",
    async start(input) {
      const source = inputs.source as SourceCheckout | undefined;
      if (!source?.directory) throw new Error("Missing source checkout");
      const identity = sourceIdentity({ ...sourceIdentity(source.identity), version: await moodleRelease(source.directory) });
      await mkdir(options.directory, { recursive: true });
      const temporary = await mkdtemp(join(options.directory, "build-"));
      try {
        const context = join(temporary, "source");
        await cp(source.directory, context, { recursive: true, verbatimSymlinks: true, filter: (path) => ![".git", "node_modules"].includes(basename(path)) });
        await writeFile(join(context, ".journey-source-sha"), identity.sourceSha + "\n");
        await writeFile(join(context, ".dockerignore"), ".git\n**/.git\nnode_modules\n**/node_modules\n");
        const files = Object.fromEntries(await Promise.all(options.verifyFiles.map(async (path) =>
          [path, createHash("sha256").update(await readFile(join(context, path))).digest("hex")] as const)));
        const recipe = `FROM ${options.runtimeImage}
COPY --from=${options.composerImage} /usr/bin/composer /usr/local/bin/composer
COPY . /var/www/html
RUN cd /var/www/html && composer install --no-dev --no-interaction --prefer-dist --classmap-authoritative \\
 && mkdir -p /var/www/moodledata && chown -R www-data:www-data /var/www/html /var/www/moodledata
`;
        await writeFile(join(context, "Dockerfile.journey"), recipe);
        const key = createHash("sha256").update(identity.sourceSha + recipe).digest("hex").slice(0, 16);
        const image = `${options.image}:journey-${key}`;
        await run("docker", ["build", "-f", join(context, "Dockerfile.journey"), "-t", image, context], resolve(options.directory), input?.signal);
        const built: MoodleImage = { image, identity, files };
        return startedService({ image: built }, identity);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
  };
}
