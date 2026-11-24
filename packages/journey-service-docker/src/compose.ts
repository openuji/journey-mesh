/**
 * The generic lifecycle of a Docker Compose stack that a service plugin owns: a private env file,
 * a fresh project, a persistent ownership record, `up`, the `composeLifecycle` publications, and a
 * release that only removes what this acquisition started. Application-specific work runs in two
 * hooks: `prepare` before the env file is written (e.g. build an image) and `bootstrap` after `up`
 * (e.g. install and verify the application). Any vendor's Compose-based stack can use it, and
 * `journey-observer-docker` observes it unchanged.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { contract, startedService, type ObservationPublisher, type StartedService } from "@openuji/journey-plugin";
import { readJsonRecord, removeOwnership, runOwnedProcess, writeJsonRecord } from "@openuji/journey-plugin/node";
import { composeLifecycle, type ComposeResource } from "./observations.js";

/** Runs a command and returns its stdout; stderr is retained in the error on failure. */
export type ComposeExecutor = (command: string, args: readonly string[], options: { cwd: string; env: Record<string, string | undefined>; signal?: AbortSignal }) => Promise<string>;
export const executeComposeCommand: ComposeExecutor = (command, args, options) => runOwnedProcess(command, args, { ...options, stdoutOnly: true });

/**
 * A running stack as other services see it: enough to run `docker compose` against its project.
 * A stack service publishes it as an output; services that act inside the stack (installing an app,
 * importing fixtures) take it as an input. Runtime connection metadata only, never provenance.
 */
export type ComposeStack = Readonly<{ project: string; composeFiles: readonly string[]; envFile: string; services: readonly string[] }>;
export const composeStackContract = contract<ComposeStack>("@openuji/docker-compose-stack/v1");

/** `docker` arguments that address a stack's own Compose project; append the Compose command. */
export function composeCommand(stack: Pick<ComposeStack, "project" | "envFile" | "composeFiles">): string[] {
  return ["compose", "--project-name", stack.project, "--env-file", stack.envFile, ...stack.composeFiles.flatMap((file) => ["-f", file])];
}

export type ComposeStackOptions = Readonly<{
  /** Names the stack in errors, e.g. `Nextcloud` in "Nextcloud startup and cleanup failed". */
  label: string;
  project: string;
  composeFiles: readonly string[];
  /** Holds the env file; commands run here unless a hook names another directory. */
  directory: string;
  /** Written to the private env file Compose reads, quoted so `$`, `#` and spaces stay literal. */
  environment: Readonly<Record<string, string>>;
  /** The variable that names the env file for the Compose files, e.g. `NEXTCLOUD_STACK_ENV_FILE`. */
  envFileVariable: string;
  /** The Compose services, as published in `composeLifecycle` resources. */
  services: readonly string[];
  /** The persistent ownership record, so an explicit shutdown can release the stack later. */
  ownershipFile: string;
}>;

/** What a hook can run: any command (in the stack directory unless `cwd` is given), until `signal` aborts. */
export type ComposeTools = Readonly<{
  run(command: string, args: readonly string[], cwd?: string): Promise<string>;
  signal?: AbortSignal;
}>;
/** After `up`: also `docker compose` against this stack's own project. */
export type ComposeProjectTools = ComposeTools & Readonly<{
  compose(...args: string[]): Promise<string>;
  /**
   * Whether a service's image has finished its entrypoint `script`: PID 1 is no longer that script.
   * Images such as Nextcloud's keep configuring the application from their entrypoint after the
   * application reports itself installed, and start the web server last; configure or use the
   * service only once this is true. An image that does not run `script` counts as finished.
   */
  entrypointFinished(service: string, script: string): Promise<boolean>;
}>;

export type ComposeStackHooks = Readonly<{
  /** Before the env file is written and before any container exists. Returns environment to add or override. */
  prepare?(tools: ComposeTools): Promise<Readonly<Record<string, string>> | void>;
  /** After `up` and the `allocated` publication. Its outputs and provenance become the started service's. */
  bootstrap(tools: ComposeProjectTools): Promise<Readonly<{ outputs: Readonly<Record<string, unknown>>; provenance?: unknown }>>;
}>;

/** The ownership record. Its shape is persisted between `services up` and `services down`; keep it stable. */
type ComposeOwnership = Readonly<{ token: string; project: string; composeFiles: readonly string[]; envFile: string; directory: string; containers?: readonly string[] }>;

export type ComposeReleaseOptions = Readonly<{
  envFileVariable: string;
  /** Release only the acquisition with this token; another acquisition's record is left alone. */
  expectedToken?: string;
  execute?: ComposeExecutor;
  /** Runs after ownership is verified and before anything is removed, e.g. the `before-release` publication. */
  beforeRelease?: () => Promise<void>;
}>;

/** Release the stack an ownership record describes: verify its containers, then `down --volumes`, then drop the record. */
export async function releaseComposeStack(path: string, { envFileVariable, expectedToken, execute = executeComposeCommand, beforeRelease }: ComposeReleaseOptions): Promise<void> {
  const owned = await readJsonRecord<ComposeOwnership>(path);
  if (!owned || expectedToken && owned.token !== expectedToken) return;
  const env = { ...process.env, [envFileVariable]: owned.envFile };
  const args = composeCommand(owned);
  if (owned.containers?.length) {
    const current = await execute("docker", [...args, "ps", "--all", "--quiet"], { cwd: owned.directory, env, signal: AbortSignal.timeout(30000) });
    if (current.split(/\s+/).filter(Boolean).some((id) => !owned.containers!.includes(id))) throw new Error(`Compose project ${owned.project} no longer belongs to this acquisition`);
  }
  await beforeRelease?.();
  await execute("docker", [...args, "down", "--volumes"], { cwd: owned.directory, env, signal: AbortSignal.timeout(60000) });
  await removeOwnership(path);
}

/** Validation that holds for any Compose stack, before anything is allocated. */
export function validateComposeConfiguration(options: Readonly<{ project: string; composeFiles: readonly string[]; services: readonly string[]; environment: Readonly<Record<string, string>> }>): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(options.project)) throw new Error("Invalid Compose project name");
  if (!options.composeFiles.length || !options.services.length) throw new Error("Compose files and services are required");
  for (const [key, value] of Object.entries(options.environment)) if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) throw new Error("Invalid stack environment entry");
}

/**
 * Start one acquisition of a Compose stack. A failure after `up` publishes `before-release` and
 * releases what this acquisition started before rethrowing; a failure before `up` leaves nothing behind.
 */
export async function startComposeStack(
  stack: ComposeStackOptions, hooks: ComposeStackHooks,
  { observations }: Readonly<{ observations: ObservationPublisher }>,
  { execute = executeComposeCommand, signal }: Readonly<{ execute?: ComposeExecutor; signal?: AbortSignal }> = {}
): Promise<StartedService> {
  const envFile = resolve(stack.directory, "stack.env");
  let environment: Readonly<Record<string, string>> = stack.environment;
  const env: Record<string, string | undefined> = { ...process.env, ...environment, [stack.envFileVariable]: envFile };
  const compose = composeCommand({ project: stack.project, envFile, composeFiles: stack.composeFiles });
  const run = (command: string, args: readonly string[], cwd = stack.directory) => execute(command, args, { cwd, env, signal });
  const docker = (...args: string[]) => run("docker", [...compose, ...args]);
  await mkdir(stack.directory, { recursive: true });
  const prepared = await hooks.prepare?.({ run, signal });
  if (prepared) { environment = { ...environment, ...prepared }; Object.assign(env, prepared); }
  // Compose consumes a private dotenv file; quote values so '$', '#' and spaces remain literal.
  await writeFile(envFile, Object.entries(environment).map(([key, value]) => `${key}='${value.replaceAll("'", "\\'")}'`).join("\n") + "\n", { mode: 0o600 });
  if (await docker("ps", "--all", "--quiet")) throw new Error(`Compose project ${stack.project} already has containers; select a fresh managed project`);
  if (await run("docker", ["volume", "ls", "--filter", `label=com.docker.compose.project=${stack.project}`, "--quiet"])) throw new Error(`Compose project ${stack.project} already has volumes; select a fresh managed project`);
  const token = randomUUID();
  const owned: ComposeOwnership = { token, project: stack.project, composeFiles: stack.composeFiles, envFile, directory: stack.directory };
  await writeJsonRecord(stack.ownershipFile, owned);
  const resource: ComposeResource = { id: token, project: stack.project, composeFiles: stack.composeFiles,
    envFile, directory: stack.directory, environment: { [stack.envFileVariable]: envFile }, services: stack.services };
  const release = () => releaseComposeStack(stack.ownershipFile, { envFileVariable: stack.envFileVariable, expectedToken: token, execute,
    beforeRelease: () => observations.publish(composeLifecycle, { phase: "before-release", resource }) });
  try {
    await docker("up", "-d");
    const containers = (await docker("ps", "--all", "--quiet")).split(/\s+/).filter(Boolean);
    await writeJsonRecord(stack.ownershipFile, { ...owned, containers });
    await observations.publish(composeLifecycle, { phase: "allocated", resource });
    const entrypointFinished = (service: string, script: string) =>
      docker("exec", "-T", service, "cat", "/proc/1/cmdline").then((cmdline) => !cmdline.includes(script), () => false);
    const { outputs, provenance } = await hooks.bootstrap({ run, compose: docker, entrypointFinished, signal });
    return startedService(outputs, provenance, release);
  } catch (error) {
    try { await release(); } catch (cleanup) { throw new AggregateError([error, cleanup], `${stack.label} startup and cleanup failed`); }
    throw error;
  }
}
