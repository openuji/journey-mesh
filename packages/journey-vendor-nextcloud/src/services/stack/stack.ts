import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { JourneyPluginContext, JourneyService, SourceIdentity } from "@openuji/journey-plugin";
import { ownershipPath } from "@openuji/journey-plugin/node";
import { executeComposeCommand, releaseComposeStack, startComposeStack, validateComposeConfiguration, type ComposeExecutor } from "@openuji/journey-service-docker/compose";

export type PinnedSource = Readonly<{ repository: string; sha: string }>;
/** A pull request is resolved to its current head commit every time the stack starts; nothing about it is pinned. */
export type PullRequestSource = Readonly<{ repository: string; pullRequest: number }>;
export type StackBuild = (PinnedSource | PullRequestSource) & Readonly<{ directory: string; dockerfile: string; apps: readonly (PinnedSource & { id: string; version: string })[] }>;
/**
 * `image` names the image to run. For a pull-request build it is a repository name without a tag; the stack tags the
 * image it builds `pr<number>-<head sha>`. `expectedVersion` may be omitted for a build: the version is then read from
 * the checked-out source, so the pull request is tested on whatever Nextcloud it is based on.
 */
export type StackOptions = Readonly<{
  project: string; composeFiles: readonly string[]; image: string; expectedVersion?: string;
  environment: Readonly<Record<string, string>>; directory: string;
  services: Readonly<Record<string, { baseURL: string; username: string; password: string }>>;
  enabledApps: readonly string[];
  systemConfig?: Readonly<Record<string, string | boolean | number>>;
  build?: StackBuild;
  sourceIdentity?: SourceIdentity;
}>;
export type StackExecutor = ComposeExecutor;
export const executeStackCommand: StackExecutor = executeComposeCommand;

/** The variable the Nextcloud Compose files read to find the stack's private env file. */
const envFileVariable = "NEXTCLOUD_STACK_ENV_FILE";
export async function stopNextcloudStack(context: JourneyPluginContext): Promise<void> { await releaseComposeStack(ownershipPath(context.configPath, context.componentId), { envFileVariable }); }

export function validateStackConfiguration(options: Pick<StackOptions, "project" | "composeFiles" | "services" | "systemConfig" | "environment">): void {
  for (const [key, value] of Object.entries(options.systemConfig ?? {})) {
    if (!/^[A-Za-z0-9_.-]+$/.test(key) || !(typeof value === "string" || typeof value === "boolean" || Number.isSafeInteger(value))) throw new Error("Invalid systemConfig entry");
  }
  validateComposeConfiguration({ project: options.project, composeFiles: options.composeFiles, services: Object.keys(options.services), environment: options.environment });
  const urls = new Set<string>();
  for (const [service, account] of Object.entries(options.services)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(service)) throw new Error("Invalid service name");
    const url = new URL(account.baseURL);
    if (!["http:", "https:"].includes(url.protocol) || urls.has(url.origin)) throw new Error("Services require distinct HTTP origins");
    urls.add(url.origin);
  }
}
export function validateStackOptions(options: StackOptions): void {
  validateStackConfiguration(options);
  const pin = (source: PinnedSource) => { if (!/^[a-f0-9]{40}$/.test(source.sha) || !/^https:\/\//.test(source.repository)) throw new Error("Sources require an HTTPS repository and exact commit SHA"); };
  if (options.build) {
    const { repository, sha, pullRequest } = options.build as { repository: string; sha?: string; pullRequest?: number };
    if ((sha === undefined) === (pullRequest === undefined)) throw new Error("A build takes exactly one of sha or pullRequest");
    if (sha !== undefined) pin({ repository, sha });
    else {
      if (!/^https:\/\//.test(repository)) throw new Error("Sources require an HTTPS repository");
      if (!Number.isSafeInteger(pullRequest) || (pullRequest as number) < 1) throw new Error("build.pullRequest must be a positive pull request number");
      if (!/^[a-z0-9][a-z0-9._/-]*$/.test(options.image)) throw new Error("A pull request build tags its own image; image must be a repository name without a tag");
    }
    for (const app of options.build.apps) { pin(app); if (!/^[a-z_]+$/.test(app.id)) throw new Error("Invalid app identifier"); }
  } else if (!options.expectedVersion) throw new Error("expectedVersion is required unless the stack is built from source");

}

/** The version Nextcloud reports for a source checkout, e.g. `36.0.0 dev`; `occ status` prints the same string. */
async function sourceVersion(directory: string): Promise<string> {
  const match = /\$OC_VersionString\s*=\s*'([^']+)'/.exec(await readFile(resolve(directory, "version.php"), "utf8"));
  if (!match?.[1]) throw new Error("Cannot read the Nextcloud version from the source's version.php");
  return match[1];
}

/** The component's runtime ports, exactly as the host scopes them in its plugin context. */
export type StackPorts = Pick<JourneyPluginContext, "artifacts" | "observations">;

export function nextcloudStackRuntime(options: StackOptions, { artifacts, observations }: StackPorts, execute: StackExecutor = executeStackCommand, ownershipFile = resolve(options.directory, "ownership.json")): JourneyService {
  options = structuredClone(options);
  validateStackOptions(options);
  return {
    name: `nextcloud-stack:${options.project}`,
    async start(input) {
      const envFile = resolve(options.directory, "stack.env");
      // A pull request's image tag and version are only known once its head commit has been fetched.
      let image = options.image;
      let sourceSha: string | null = options.sourceIdentity?.sourceSha ?? null;
      let pullRequest: number | null = null;
      let expectedVersion = options.expectedVersion;
      return startComposeStack({
        label: "Nextcloud", project: options.project, composeFiles: options.composeFiles, directory: options.directory,
        environment: { ...options.environment, NEXTCLOUD_IMAGE: options.image }, envFileVariable,
        services: Object.keys(options.services), ownershipFile
      }, {
        /** Check out and build the server when the stack is built from source; nothing runs yet. */
        async prepare({ run }) {
          /** Fetch `ref` into the clone at `directory`, check out what it points at, and return that commit. */
          const checkout = async (repository: string, ref: string, directory: string): Promise<string> => {
            const head = await run("git", ["rev-parse", "--show-toplevel"], directory).catch(() => null);
            const reused = !!head && resolve(head) === resolve(directory);
            if (!reused) {
              await mkdir(dirname(directory), { recursive: true });
              await run("git", ["clone", "--no-checkout", "--filter=blob:none", repository, directory]);
            }
            // Only a checkout that already existed can hold local changes. A fresh --no-checkout clone has an empty index,
            // so `git status` reports every tracked file as deleted.
            if (reused && await run("git", ["status", "--porcelain", "--untracked-files=no"], directory)) throw new Error("Refusing to build modified source");
            await run("git", ["fetch", "origin", ref], directory).catch((error: Error) => { throw new Error(`Cannot fetch ${ref} from ${repository}: ${error.message}`); });
            const sha = await run("git", ["rev-parse", "FETCH_HEAD^{commit}"], directory);
            await run("git", ["checkout", "--detach", sha], directory);
            if (await run("git", ["rev-parse", "HEAD"], directory) !== sha) throw new Error("Source checkout SHA mismatch");
            return sha;
          };
          const checkoutPinned = async (source: PinnedSource, directory: string) => {
            if (await checkout(source.repository, source.sha, directory) !== source.sha) throw new Error("Source checkout SHA mismatch");
          };
          if (options.build) {
            const build = options.build;
            if ("pullRequest" in build) {
              pullRequest = build.pullRequest;
              sourceSha = await checkout(build.repository, `refs/pull/${build.pullRequest}/head`, build.directory);
              image = `${options.image}:pr${build.pullRequest}-${sourceSha.slice(0, 12)}`;
            } else {
              await checkoutPinned(build, build.directory);
              sourceSha = build.sha;
            }
            await run("git", ["submodule", "update", "--init", "--depth", "1"], build.directory);
            for (const app of build.apps) await checkoutPinned(app, resolve(build.directory, "apps", app.id));
            await writeFile(resolve(build.directory, ".source-sha"), `${sourceSha}\n`);
            await writeFile(resolve(build.directory, ".dockerignore"), ".git\n**/.git\nnode_modules\n**/node_modules\n");
            expectedVersion ??= await sourceVersion(build.directory);
            await run("docker", ["build", "-f", build.dockerfile, "--build-arg", `SOURCE_SHA=${sourceSha}`, "-t", image, build.directory]);
          }
          if (!expectedVersion) throw new Error("expectedVersion is required unless the stack is built from source");
          return { NEXTCLOUD_IMAGE: image };
        },
        /** Install, configure and verify every Nextcloud service of the running stack, then record its identity. */
        async bootstrap({ run, compose: docker, signal: activeSignal }) {
          const occ = (service: string, ...args: string[]) => docker("exec", "-T", "-u", "www-data", service, "php", "occ", ...args);
          /**
           * The image's entrypoint keeps writing config.php (one `occ config:system:set` per trusted domain) after
           * `occ status` reports installed, and only then execs the web server. Nextcloud writes config.php from the
           * copy each process loaded, so a setting written concurrently is lost. Configure only once PID 1 is no
           * longer the entrypoint script. An image without that script counts as started.
           */
          const started = (service: string) => docker("exec", "-T", service, "cat", "/proc/1/cmdline").then((cmdline) => !cmdline.includes("entrypoint.sh"), () => false);
          const services: unknown[] = [];
          for (const [service, account] of Object.entries(options.services)) {
            let status: { installed?: boolean; versionstring?: string } | undefined;
            let ready = false;
            for (let attempt = 0; attempt < 120; attempt++) {
              activeSignal?.throwIfAborted();
              status = await occ(service, "status", "--output=json").then((text) => JSON.parse(text)).catch(() => undefined);
              if (status?.installed && (ready = await started(service))) break;
              await new Promise<void>((accept) => setTimeout(accept, 2000));
            }
            if (!status?.installed || !(status.versionstring === expectedVersion || status.versionstring?.startsWith(`${expectedVersion} `))) throw new Error(`${service}: installed version does not match ${expectedVersion}`);
            if (!ready) throw new Error(`${service}: the image's entrypoint script did not finish`);
            const url = new URL(account.baseURL);
            for (const app of ["federation", "files_sharing", ...options.enabledApps]) await occ(service, "app:enable", app);
            await occ(service, "app:disable", "firstrunwizard").catch(() => {});
            const system: readonly Readonly<{ key: readonly string[]; value: string; type?: string }>[] = [
              ...Object.entries({ "trusted_domains 0": url.hostname, "trusted_domains 1": url.host, "trusted_domains 2": service, "overwritehost": url.host, "overwriteprotocol": url.protocol.slice(0, -1), "overwrite.cli.url": url.origin })
                .map(([key, value]) => ({ key: key.split(" "), value })),
              { key: ["allow_local_remote_servers"], value: "true", type: "boolean" },
              ...Object.entries(options.systemConfig ?? {}).map(([key, value]) => ({ key: [key], value: String(value), type: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "integer" : "string" }))
            ];
            const set = (setting: (typeof system)[number]) => occ(service, "config:system:set", ...setting.key, ...(setting.type ? [`--type=${setting.type}`] : []), `--value=${setting.value}`);
            for (const setting of system) await set(setting);
            // Any later concurrent config.php write could still drop a value: read every one back and apply the lost ones again.
            for (let round = 1; ; round++) {
              const lost: (typeof system)[number][] = [];
              for (const setting of system) if ((await occ(service, "config:system:get", ...setting.key).catch(() => undefined))?.trim() !== setting.value) lost.push(setting);
              if (!lost.length) break;
              if (round === 3) throw new Error(`${service}: ${lost.map((setting) => setting.key.join(" ")).join(", ")} did not keep the configured value`);
              for (const setting of lost) await set(setting);
            }
            for (const key of ["incoming_server2server_share_enabled", "outgoing_server2server_share_enabled"]) await occ(service, "config:app:set", "files_sharing", key, "--value=yes");
            const exists = await occ(service, "user:info", account.username).then(() => true).catch(() => false);
            if (!exists) await docker("exec", "-T", "-e", `OC_PASS=${account.password}`, "-u", "www-data", service, "php", "occ", "user:add", "--password-from-env", account.username);
            if (options.build || options.sourceIdentity) {
              const sha = await docker("exec", "-T", service, "cat", "/var/www/html/.journey-source-sha");
              if (sha !== sourceSha) throw new Error(`${service}: installed source SHA mismatch`);
              for (const app of options.build?.apps ?? []) {
                await docker("exec", "-T", service, "cp", "-a", `/usr/src/nextcloud/custom_apps/${app.id}`, "/var/www/html/custom_apps/");
                await docker("exec", "-T", service, "chown", "-R", "www-data:www-data", `/var/www/html/custom_apps/${app.id}`);
              }
            }
            const apps = JSON.parse(await occ(service, "app:list", "--output=json"));
            for (const app of options.enabledApps) if (!apps.enabled[app]) throw new Error(`${service}: ${app} must be enabled`);
            for (const app of options.build?.apps ?? []) if (apps.enabled[app.id] !== app.version) throw new Error(`${service}: app version mismatch for ${app.id}`);
            const container = await docker("ps", "-q", service);
            const imageId = await run("docker", ["inspect", "--format", "{{.Image}}", container]);
            const expectedImageId = await run("docker", ["image", "inspect", "--format", "{{.Id}}", image]);
            if (imageId !== expectedImageId) throw new Error(`${service}: installed image mismatch`);
            services.push({ service, version: status.versionstring, imageId, sourceSha, apps: Object.fromEntries(options.enabledApps.map((app) => [app, apps.enabled[app]])) });
          }
          const identity = { project: options.project, image, ...(pullRequest === null ? {} : { pullRequest }), verifiedAt: new Date().toISOString(), services };
          await artifacts.write({ name: `${options.project}.identity.json`, data: JSON.stringify(identity, null, 2), contentType: "application/json" });
          return {
            outputs: { stack: { project: options.project, composeFiles: options.composeFiles, envFile, services: Object.keys(options.services) },
              ...(options.sourceIdentity ? { identity: options.sourceIdentity } : {}) },
            provenance: identity
          };
        }
      }, { observations }, { execute, signal: input.signal });
    }
  };
}
