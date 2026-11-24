import { resolve } from "node:path";
import type { JourneyPluginContext, JourneyService } from "@openuji/journey-plugin";
import { ownershipPath } from "@openuji/journey-plugin/node";
import {
  executeComposeCommand, releaseComposeStack, startComposeStack, validateComposeConfiguration, type ComposeExecutor, type ComposeStack
} from "@openuji/journey-service-docker/compose";
import type { MoodleImage } from "../contracts.js";

export type MoodleStackOptions = Readonly<{
  project: string;
  composeFiles: readonly string[];
  /** Holds the stack's private env file and its ownership record. */
  directory: string;
  /** Written to the env file the Compose files read; the stack adds `MOODLE_IMAGE`. */
  environment: Readonly<Record<string, string>>;
  /** The Compose service that runs Moodle. */
  service: string;
  /** `wwwroot`: the URL browsers and journeys use. */
  baseURL: string;
  site: Readonly<{ fullname: string; shortname: string }>;
  admin: Readonly<{ username: string; password: string; email: string }>;
  /** PostgreSQL, as the Moodle container reaches it. */
  database: Readonly<{ host: string; name: string; user: string; password: string }>;
  /** Site settings applied after installation with `admin/cli/cfg.php` and read back, e.g. `theme: boost`. */
  config: Readonly<Record<string, string>>;
}>;

/** The variable the Compose files read to find the stack's private env file. */
const envFileVariable = "MOODLE_STACK_ENV_FILE";
/** `moodlehq/moodle-php-apache` runs this script as PID 1, then execs Apache. */
const entrypointScript = "moodle-docker-php-entrypoint";
const sourceRoot = "/var/www/html";

export function validateMoodleStackOptions(options: MoodleStackOptions): void {
  validateComposeConfiguration({ project: options.project, composeFiles: options.composeFiles, services: [options.service], environment: options.environment });
  if (!/^[a-z][a-z0-9_-]*$/.test(options.service)) throw new Error("Invalid Moodle service name");
  const url = new URL(options.baseURL);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("baseURL must be an HTTP URL");
  if (!/^[a-z0-9_.@-]+$/.test(options.admin.username) || !options.admin.password || !options.admin.email.includes("@")) throw new Error("admin needs a lowercase username, a password and an email");
  for (const [key, value] of Object.entries(options.database)) if (!value) throw new Error(`database.${key} is required`);
  if (!options.site.fullname || !options.site.shortname) throw new Error("site needs a fullname and a shortname");
  for (const [key, value] of Object.entries(options.config)) if (!/^[a-z0-9_]+$/.test(key) || /[\r\n]/.test(value)) throw new Error(`Invalid config entry ${key}`);
}

export async function stopMoodleStack(context: JourneyPluginContext): Promise<void> {
  await releaseComposeStack(ownershipPath(context.configPath, context.componentId), { envFileVariable });
}

export type StackPorts = Pick<JourneyPluginContext, "artifacts" | "observations">;

/** A Moodle site installed fresh from a built image, verified against that image before journeys use it. */
export function moodleStackRuntime(options: MoodleStackOptions, image: MoodleImage, { artifacts, observations }: StackPorts, execute: ComposeExecutor = executeComposeCommand, ownershipFile = resolve(options.directory, "ownership.json")): JourneyService {
  options = structuredClone(options);
  validateMoodleStackOptions(options);
  const { service } = options;
  return {
    name: `moodle-stack:${options.project}`,
    async start(input) {
      const envFile = resolve(options.directory, "stack.env");
      return startComposeStack({
        label: "Moodle", project: options.project, composeFiles: options.composeFiles, directory: options.directory,
        environment: { ...options.environment, MOODLE_IMAGE: image.image }, envFileVariable, services: [service], ownershipFile
      }, {
        async bootstrap({ run, compose, entrypointFinished, signal }) {
          // The installer and the journeys need Apache, which the image starts only after its entrypoint.
          let started = false;
          for (let attempt = 0; attempt < 120 && !(started = await entrypointFinished(service, entrypointScript)); attempt++) {
            signal?.throwIfAborted();
            await new Promise<void>((accept) => setTimeout(accept, 2000));
          }
          if (!started) throw new Error(`${service}: the image's entrypoint script did not finish`);
          const php = (...args: string[]) => compose("exec", "-T", "-u", "www-data", "-w", sourceRoot, service, "php", ...args);
          const { admin, database, site } = options;
          await php("admin/cli/install.php", "--non-interactive", "--agree-license", "--lang=en", `--wwwroot=${options.baseURL}`, "--dataroot=/var/www/moodledata",
            "--dbtype=pgsql", `--dbhost=${database.host}`, `--dbname=${database.name}`, `--dbuser=${database.user}`, `--dbpass=${database.password}`,
            `--fullname=${site.fullname}`, `--shortname=${site.shortname}`, `--adminuser=${admin.username}`, `--adminpass=${admin.password}`, `--adminemail=${admin.email}`);
          for (const [name, value] of Object.entries(options.config)) await php("admin/cli/cfg.php", `--name=${name}`, `--set=${value}`);
          for (const [name, value] of Object.entries(options.config)) {
            const actual = (await php("admin/cli/cfg.php", `--name=${name}`)).trim();
            if (actual !== value) throw new Error(`${service}: config ${name} is ${actual}, not ${value}`);
          }
          const release = (await php("admin/cli/cfg.php", "--name=release")).trim();
          if (release !== image.identity.version) throw new Error(`${service}: installed release ${release} does not match the built source ${image.identity.version}`);
          const sha = (await compose("exec", "-T", service, "cat", `${sourceRoot}/.journey-source-sha`)).trim();
          if (sha !== image.identity.sourceSha) throw new Error(`${service}: installed source SHA mismatch`);
          for (const [path, expected] of Object.entries(image.files)) {
            const actual = (await compose("exec", "-T", service, "sha256sum", `${sourceRoot}/${path}`)).trim().split(/\s+/)[0];
            if (actual !== expected) throw new Error(`${service}: ${path} differs from the built source`);
          }
          const container = (await compose("ps", "-q", service)).trim();
          const imageId = await run("docker", ["inspect", "--format", "{{.Image}}", container]);
          const expectedImageId = await run("docker", ["image", "inspect", "--format", "{{.Id}}", image.image]);
          if (imageId !== expectedImageId) throw new Error(`${service}: installed image mismatch`);
          const identity = { project: options.project, service, image: image.image, imageId, release, sourceSha: sha, files: image.files, verifiedAt: new Date().toISOString() };
          await artifacts.write({ name: `${options.project}.identity.json`, data: JSON.stringify(identity, null, 2), contentType: "application/json" });
          const stack: ComposeStack = { project: options.project, composeFiles: options.composeFiles, envFile, services: [service] };
          return { outputs: { stack, identity: image.identity }, provenance: identity };
        }
      }, { observations }, { execute, signal: input.signal });
    }
  };
}
