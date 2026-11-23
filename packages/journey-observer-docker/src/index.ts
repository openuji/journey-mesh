import type { JourneyArtifactStore, RuntimeObserver } from "@openuji/journey-plugin";
import { runOwnedProcess } from "@openuji/journey-plugin/node";
import { composeLifecycle, type ComposeResource } from "@openuji/journey-service-docker/observations";

export type DockerObservationOptions = Readonly<{
  containerLogs: boolean;
  tail: number;
  timeoutMs: number;
  files: readonly Readonly<{ name: string; path: string }>[];
}>;
export type DockerObservationExecutor = (args: readonly string[], resource: ComposeResource, signal: AbortSignal) => Promise<string>;
const executeDocker: DockerObservationExecutor = (args, resource, signal) => runOwnedProcess("docker", args, {
  cwd: resource.directory, env: { ...process.env, ...resource.environment }, signal, stdoutOnly: true
});

/** Consumes any Compose producer. File paths and capture policy come from composition, never the stack. */
export function createDockerRuntimeObserver(options: DockerObservationOptions, artifacts: JourneyArtifactStore,
  execute: DockerObservationExecutor = executeDocker): RuntimeObserver {
  options = structuredClone(options);
  let unsubscribe: (() => void) | undefined;
  return {
    start(source) {
      unsubscribe = source.subscribe(composeLifecycle, async ({ value: { phase, resource } }, signal) => {
        if (phase !== "before-release") return;
        const compose = ["compose", "--project-name", resource.project, "--env-file", resource.envFile,
          ...resource.composeFiles.flatMap((file) => ["-f", file])];
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
      }, { name: "docker-runtime-observer", timeoutMs: options.timeoutMs });
    },
    close() { unsubscribe?.(); unsubscribe = undefined; }
  };
}
