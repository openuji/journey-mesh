import { contract } from "@openuji/journey-plugin";

/** Runtime connection metadata, never provenance. Contains no Docker client or application logic. */
export type ComposeResource = Readonly<{
  id: string;
  project: string;
  composeFiles: readonly string[];
  envFile: string;
  directory: string;
  environment: Readonly<Record<string, string>>;
  services: readonly string[];
}>;
export type ComposeLifecycleObservation = Readonly<{ phase: "allocated" | "before-release"; resource: ComposeResource }>;
export const composeLifecycle = contract<ComposeLifecycleObservation>("@openuji/docker-compose-lifecycle/v1");

/** Output of the Compose command that starts a stack (image pulls, container creation), one line per new state. */
export type ComposeProgressObservation = Readonly<{ project: string; line: string }>;
export const composeProgress = contract<ComposeProgressObservation>("@openuji/docker-compose-progress/v1");
