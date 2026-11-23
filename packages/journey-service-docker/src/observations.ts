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
