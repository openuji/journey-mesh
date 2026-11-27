import { serviceLifecycle, type JourneyArtifactStore, type RuntimeObserver } from "@openuji/journey-plugin";
import { lineReader, runOwnedProcess } from "@openuji/journey-plugin/node";
import { composeLifecycle, composeProgress, type ComposeResource } from "@openuji/journey-service-docker/observations";

export type DockerObservationOptions = Readonly<{
  containerLogs: boolean;
  tail: number;
  timeoutMs: number;
  files: readonly Readonly<{ name: string; path: string }>[];
  /** Print Compose's startup output and, until the service that started the stack is ready, its container logs. */
  progress?: boolean;
}>;
export type DockerObservationExecutor = (args: readonly string[], resource: ComposeResource, signal: AbortSignal) => Promise<string>;
const executeDocker: DockerObservationExecutor = (args, resource, signal) => runOwnedProcess("docker", args, {
  cwd: resource.directory, env: { ...process.env, ...resource.environment }, signal, stdoutOnly: true
});

/** Streams a command's output until it ends or `signal` aborts. */
export type DockerLogFollower = (args: readonly string[], resource: ComposeResource, signal: AbortSignal, onOutput: (data: string) => void) => Promise<void>;
const followDocker: DockerLogFollower = async (args, resource, signal, onOutput) => {
  await runOwnedProcess("docker", args, { cwd: resource.directory, env: { ...process.env, ...resource.environment }, signal, onOutput });
};
const composeArguments = (resource: ComposeResource) => ["compose", "--project-name", resource.project, "--env-file", resource.envFile,
  ...resource.composeFiles.flatMap((file) => ["-f", file])];

/** Consumes any Compose producer. File paths and capture policy come from composition, never the stack. */
export function createDockerRuntimeObserver(options: DockerObservationOptions, artifacts: JourneyArtifactStore,
  execute: DockerObservationExecutor = executeDocker,
  { follow = followDocker, log = console.log }: Readonly<{ follow?: DockerLogFollower; log?: (line: string) => void }> = {}): RuntimeObserver {
  options = structuredClone(options);
  let unsubscribe: readonly (() => void)[] = [];
  /** Running log followers by the service that started the stack; `ended` outlives the entry for `close`. */
  const following = new Map<string, AbortController[]>();
  const ended: Promise<void>[] = [];
  const stopFollowing = (producer: string) => {
    for (const controller of following.get(producer) ?? []) controller.abort();
    following.delete(producer);
  };
  const followLogs = (producer: string, resource: ComposeResource) => {
    const controller = new AbortController();
    const lines = lineReader((line) => { if (!controller.signal.aborted) log(`[${producer}] ${line}`); });
    following.set(producer, [...following.get(producer) ?? [], controller]);
    ended.push(follow([...composeArguments(resource), "logs", "--follow", "--no-color"], resource, controller.signal, lines.write)
      .then(lines.flush)
      .catch((error) => { if (!controller.signal.aborted) log(`[${producer}] container logs stopped: ${error instanceof Error ? error.message : String(error)}`); }));
  };
  return {
    start(source) {
      const progress = options.progress ? [
        source.subscribe(composeProgress, ({ source: producer, value }) => log(`[${producer}] ${value.line}`), { name: "docker-runtime-observer" }),
        source.subscribe(serviceLifecycle, ({ source: producer, value: { phase } }) => {
          if (phase === "ready" || phase === "failed") stopFollowing(producer);
        }, { name: "docker-runtime-observer" })
      ] : [];
      unsubscribe = [...progress, source.subscribe(composeLifecycle, async ({ source: producer, value: { phase, resource } }, signal) => {
        if (phase === "allocated" && options.progress) followLogs(producer, resource);
        if (phase !== "before-release") return;
        stopFollowing(producer);
        const compose = composeArguments(resource);
        const captures = [
          ...(options.containerLogs ? [{ name: `${resource.project}.compose.log`, args: [...compose, "logs", "--no-color", "--timestamps", "--tail", String(options.tail)] }] : []),
          ...options.files.flatMap((file) => resource.services.map((service) => ({
            name: `${resource.project}.${service}.${file.name}.log`,
            args: [...compose, "exec", "-T", service, "tail", "-n", String(options.tail), "--", file.path]
          })))
        ];
        const results = await Promise.allSettled(captures.map(async ({ name, args }) => {
          const data = await execute(args, resource, signal).catch((error) => `Diagnostic capture failed: ${error instanceof Error ? error.message : String(error)}`);
          await artifacts.write({ name, data, contentType: "text/plain" });
        }));
        const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
        if (errors.length) throw new AggregateError(errors, "Could not persist Docker diagnostic captures");
      }, { name: "docker-runtime-observer", timeoutMs: options.timeoutMs })];
    },
    async close() {
      for (const stop of unsubscribe) stop();
      unsubscribe = [];
      for (const producer of [...following.keys()]) stopFollowing(producer);
      await Promise.all(ended.splice(0));
    }
  };
}
