import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { SourceIdentity } from "@openuji/journey-plugin";
import { dirname, resolve } from "node:path";
import type { JourneyArtifactStore, JourneyService } from "@openuji/journey-plugin";

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
export type StackExecutor = (command: string, args: readonly string[], options: { cwd: string; env: Record<string, string | undefined>; signal?: AbortSignal }) => Promise<string>;
export const executeStackCommand: StackExecutor = (command, args, options) => new Promise((accept, reject) => {
  const child = spawn(command, [...args], { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; let diagnostic = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { diagnostic = (diagnostic + chunk).slice(-12000); });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? accept(output.trim()) : reject(new Error(`${command} ${args[0] ?? ""} failed (${code}): ${diagnostic}`)));
});

export function validateStackOptions(options: StackOptions): void {
  for (const [key, value] of Object.entries(options.systemConfig ?? {})) {
    if (!/^[A-Za-z0-9_.-]+$/.test(key) || !(typeof value === "string" || typeof value === "boolean" || Number.isSafeInteger(value))) throw new Error("Invalid systemConfig entry");
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(options.project)) throw new Error("Invalid Compose project name");
  if (!options.composeFiles.length || !Object.keys(options.services).length) throw new Error("Compose files and services are required");
  const urls = new Set<string>();
  for (const [service, account] of Object.entries(options.services)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(service)) throw new Error("Invalid service name");
    const url = new URL(account.baseURL);
    if (!["http:", "https:"].includes(url.protocol) || urls.has(url.origin)) throw new Error("Services require distinct HTTP origins");
    urls.add(url.origin);
  }
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
  for (const [key, value] of Object.entries(options.environment)) if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) throw new Error("Invalid stack environment entry");
}

/** The version Nextcloud reports for a source checkout, e.g. `36.0.0 dev`; `occ status` prints the same string. */
async function sourceVersion(directory: string): Promise<string> {
  const match = /\$OC_VersionString\s*=\s*'([^']+)'/.exec(await readFile(resolve(directory, "version.php"), "utf8"));
  if (!match?.[1]) throw new Error("Cannot read the Nextcloud version from the source's version.php");
  return match[1];
}

export function nextcloudStackRuntime(options: StackOptions, artifacts: JourneyArtifactStore, execute: StackExecutor = executeStackCommand): JourneyService {
  options = structuredClone(options);
  validateStackOptions(options);
  const envFile = resolve(options.directory, "stack.env");
  const env: Record<string, string | undefined> = { ...process.env, ...options.environment, NEXTCLOUD_IMAGE: options.image, NEXTCLOUD_STACK_ENV_FILE: envFile };
  // A pull request's image tag and version are only known once its head commit has been fetched.
  let image = options.image;
  let sourceSha: string | null = options.sourceIdentity?.sourceSha ?? null;
  let pullRequest: number | null = null;
  const compose = ["compose", "--project-name", options.project, "--env-file", envFile, ...options.composeFiles.flatMap((file) => ["-f", file])];
  let identity: unknown = null;
  let attemptedUp = false;
  let ownsStack = false;
  let activeSignal: AbortSignal | undefined;
  const run = (command: string, args: readonly string[], cwd = options.directory) => execute(command, args, { cwd, env, signal: activeSignal });
  const docker = (...args: string[]) => run("docker", [...compose, ...args]);
  const occ = (service: string, ...args: string[]) => docker("exec", "-T", "-u", "www-data", service, "php", "occ", ...args);
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
  return {
    name: `nextcloud-stack:${options.project}`,
    provenance() { return identity; },
    async up(input) {
      attemptedUp = true;
      activeSignal = input?.signal;
      await mkdir(options.directory, { recursive: true });
      let expectedVersion = options.expectedVersion;
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
      env.NEXTCLOUD_IMAGE = image;
      // Compose consumes a private dotenv file; quote values so '$', '#' and spaces remain literal.
      await writeFile(envFile, Object.entries({ ...options.environment, NEXTCLOUD_IMAGE: image }).map(([key, value]) => `${key}='${value.replaceAll("'", "\\'")}'`).join("\n") + "\n", { mode: 0o600 });
      if (await docker("ps", "--all", "--quiet")) throw new Error(`Compose project ${options.project} already has containers; select a fresh managed project`);
      if (await run("docker", ["volume", "ls", "--filter", `label=com.docker.compose.project=${options.project}`, "--quiet"])) throw new Error(`Compose project ${options.project} already has volumes; select a fresh managed project`);
      ownsStack = true;
      await docker("up", "-d");
      const services: unknown[] = [];
      for (const [service, account] of Object.entries(options.services)) {
        let status: { installed?: boolean; versionstring?: string } | undefined;
        for (let attempt = 0; attempt < 120; attempt++) {
          activeSignal?.throwIfAborted();
          status = await occ(service, "status", "--output=json").then((text) => JSON.parse(text)).catch(() => undefined);
          if (status?.installed) break;
          await new Promise<void>((accept) => setTimeout(accept, 2000));
        }
        if (!status?.installed || !(status.versionstring === expectedVersion || status.versionstring?.startsWith(`${expectedVersion} `))) throw new Error(`${service}: installed version does not match ${expectedVersion}`);
        const url = new URL(account.baseURL);
        for (const app of ["federation", "files_sharing", ...options.enabledApps]) await occ(service, "app:enable", app);
        await occ(service, "app:disable", "firstrunwizard").catch(() => {});
        for (const [key, value] of Object.entries({ "trusted_domains 0": url.hostname, "trusted_domains 1": url.host, "trusted_domains 2": service, "overwritehost": url.host, "overwriteprotocol": url.protocol.slice(0, -1), "overwrite.cli.url": url.origin })) await occ(service, "config:system:set", ...key.split(" "), `--value=${value}`);
        await occ(service, "config:system:set", "allow_local_remote_servers", "--type=boolean", "--value=true");
        for (const [key, value] of Object.entries(options.systemConfig ?? {})) {
          const type = typeof value === "boolean" ? "boolean" : typeof value === "number" ? "integer" : "string";
          await occ(service, "config:system:set", key, `--type=${type}`, `--value=${value}`);
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
      identity = { project: options.project, image, ...(pullRequest === null ? {} : { pullRequest }), verifiedAt: new Date().toISOString(), services };
      await artifacts.write({ name: `${options.project}.identity.json`, data: JSON.stringify(identity, null, 2), contentType: "application/json" });
      return { stack: { project: options.project, composeFiles: options.composeFiles, envFile, services: Object.keys(options.services) },
        ...(options.sourceIdentity ? { identity: options.sourceIdentity } : {}) };
    },
    async down() {
      if (attemptedUp && !ownsStack) return;
      activeSignal = undefined;
      await mkdir(options.directory, { recursive: true });
      await docker("down", "--volumes");
    }
  };
}
