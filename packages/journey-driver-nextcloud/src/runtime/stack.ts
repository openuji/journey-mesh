import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { JourneyArtifactStore, JourneyService } from "@openuji/journey-plugin";

export type PinnedSource = Readonly<{ repository: string; sha: string }>;
export type StackOptions = Readonly<{
  project: string; composeFiles: readonly string[]; image: string; expectedVersion: string;
  environment: Readonly<Record<string, string>>; directory: string;
  services: Readonly<Record<string, { baseURL: string; username: string; password: string }>>;
  enabledApps: readonly string[];
  build?: PinnedSource & { directory: string; dockerfile: string; apps: readonly (PinnedSource & { id: string; version: string })[] };
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
    pin(options.build);
    for (const app of options.build.apps) { pin(app); if (!/^[a-z_]+$/.test(app.id)) throw new Error("Invalid app identifier"); }
  }
  for (const [key, value] of Object.entries(options.environment)) if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) throw new Error("Invalid stack environment entry");
}

export function nextcloudStackRuntime(options: StackOptions, artifacts: JourneyArtifactStore, execute: StackExecutor = executeStackCommand): JourneyService {
  options = structuredClone(options);
  validateStackOptions(options);
  const envFile = resolve(options.directory, "stack.env");
  const env = { ...process.env, ...options.environment, NEXTCLOUD_IMAGE: options.image, NEXTCLOUD_STACK_ENV_FILE: envFile };
  const compose = ["compose", "--project-name", options.project, "--env-file", envFile, ...options.composeFiles.flatMap((file) => ["-f", file])];
  let identity: unknown = null;
  let attemptedUp = false;
  let ownsStack = false;
  let activeSignal: AbortSignal | undefined;
  const run = (command: string, args: readonly string[], cwd = options.directory) => execute(command, args, { cwd, env, signal: activeSignal });
  const docker = (...args: string[]) => run("docker", [...compose, ...args]);
  const occ = (service: string, ...args: string[]) => docker("exec", "-T", "-u", "www-data", service, "php", "occ", ...args);
  const checkout = async (source: PinnedSource, directory: string) => {
    const head = await run("git", ["rev-parse", "--show-toplevel"], directory).catch(() => null);
    if (!head || resolve(head) !== resolve(directory)) {
      await mkdir(dirname(directory), { recursive: true });
      await run("git", ["clone", "--no-checkout", "--filter=blob:none", source.repository, directory]);
    }
    if (await run("git", ["status", "--porcelain", "--untracked-files=no"], directory)) throw new Error("Refusing to build modified source");
    await run("git", ["fetch", "origin", source.sha], directory);
    await run("git", ["checkout", "--detach", source.sha], directory);
    if (await run("git", ["rev-parse", "HEAD"], directory) !== source.sha) throw new Error("Source checkout SHA mismatch");
  };
  return {
    name: `nextcloud-stack:${options.project}`,
    provenance() { return identity; },
    async up(input) {
      attemptedUp = true;
      activeSignal = input?.signal;
      await mkdir(options.directory, { recursive: true });
      // Compose consumes a private dotenv file; quote values so '$', '#' and spaces remain literal.
      await writeFile(envFile, Object.entries({ ...options.environment, NEXTCLOUD_IMAGE: options.image }).map(([key, value]) => `${key}='${value.replaceAll("'", "\\'")}'`).join("\n") + "\n", { mode: 0o600 });
      if (options.build) {
        const build = options.build;
        await checkout(build, build.directory);
        await run("git", ["submodule", "update", "--init", "--depth", "1"], build.directory);
        for (const app of build.apps) await checkout(app, resolve(build.directory, "apps", app.id));
        await writeFile(resolve(build.directory, ".source-sha"), `${build.sha}\n`);
        await writeFile(resolve(build.directory, ".dockerignore"), ".git\n**/.git\nnode_modules\n**/node_modules\n");
        await run("docker", ["build", "-f", build.dockerfile, "--build-arg", `SOURCE_SHA=${build.sha}`, "-t", options.image, build.directory]);
      }
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
        if (!status?.installed || !(status.versionstring === options.expectedVersion || status.versionstring?.startsWith(`${options.expectedVersion} `))) throw new Error(`${service}: installed version does not match ${options.expectedVersion}`);
        const url = new URL(account.baseURL);
        for (const app of ["federation", "files_sharing", ...options.enabledApps]) await occ(service, "app:enable", app);
        await occ(service, "app:disable", "firstrunwizard").catch(() => {});
        for (const [key, value] of Object.entries({ "trusted_domains 0": url.hostname, "trusted_domains 1": url.host, "trusted_domains 2": service, "overwritehost": url.host, "overwriteprotocol": url.protocol.slice(0, -1), "overwrite.cli.url": url.origin })) await occ(service, "config:system:set", ...key.split(" "), `--value=${value}`);
        await occ(service, "config:system:set", "allow_local_remote_servers", "--type=boolean", "--value=true");
        for (const key of ["incoming_server2server_share_enabled", "outgoing_server2server_share_enabled"]) await occ(service, "config:app:set", "files_sharing", key, "--value=yes");
        const exists = await occ(service, "user:info", account.username).then(() => true).catch(() => false);
        if (!exists) await docker("exec", "-T", "-e", `OC_PASS=${account.password}`, "-u", "www-data", service, "php", "occ", "user:add", "--password-from-env", account.username);
        if (options.build) {
          const sha = await docker("exec", "-T", service, "cat", "/var/www/html/.journey-source-sha");
          if (sha !== options.build.sha) throw new Error(`${service}: installed source SHA mismatch`);
          for (const app of options.build.apps) {
            await docker("exec", "-T", service, "cp", "-a", `/usr/src/nextcloud/custom_apps/${app.id}`, "/var/www/html/custom_apps/");
            await docker("exec", "-T", service, "chown", "-R", "www-data:www-data", `/var/www/html/custom_apps/${app.id}`);
          }
        }
        const apps = JSON.parse(await occ(service, "app:list", "--output=json"));
        for (const app of options.enabledApps) if (!apps.enabled[app]) throw new Error(`${service}: ${app} must be enabled`);
        for (const app of options.build?.apps ?? []) if (apps.enabled[app.id] !== app.version) throw new Error(`${service}: app version mismatch for ${app.id}`);
        const container = await docker("ps", "-q", service);
        const imageId = await run("docker", ["inspect", "--format", "{{.Image}}", container]);
        const expectedImageId = await run("docker", ["image", "inspect", "--format", "{{.Id}}", options.image]);
        if (imageId !== expectedImageId) throw new Error(`${service}: installed image mismatch`);
        services.push({ service, version: status.versionstring, imageId, sourceSha: options.build?.sha ?? null, apps: Object.fromEntries(options.enabledApps.map((app) => [app, apps.enabled[app]])) });
      }
      identity = { project: options.project, image: options.image, verifiedAt: new Date().toISOString(), services };
      await artifacts.write({ name: `${options.project}.identity.json`, data: JSON.stringify(identity, null, 2), contentType: "application/json" });
    },
    async down() {
      if (attemptedUp && !ownsStack) return;
      activeSignal = undefined;
      await mkdir(options.directory, { recursive: true });
      await docker("down", "--volumes");
    }
  };
}
