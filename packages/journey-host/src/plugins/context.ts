import { dirname, resolve } from "node:path";
import type { JourneyArtifactStore, JourneyPluginContext } from "@openuji/journey-plugin";
import type { JourneyPlanOperation } from "@openuji/journey-runner";
import type { Environment } from "../config/load.js";

export type ContextInput = Readonly<{
  configPath: string;
  env: Environment;
  testId: string;
  artifacts: JourneyArtifactStore;
  /** The operations the component sees; references resolve only among them. */
  operations?: readonly JourneyPlanOperation[];
  /** Configured `<journey item>.<alias>` names mapped to plan operation IDs. */
  aliases?: ReadonlyMap<string, string>;
}>;

/** Every plugin context is built here, with its operation scope fixed at construction. */
export function pluginContext({ configPath, env, testId, artifacts, operations = [], aliases = new Map() }: ContextInput): JourneyPluginContext {
  return Object.freeze({
    configPath, env, testId, artifacts, operations,
    resolvePath: (path: string) => resolve(dirname(configPath), path),
    resolveOperation(reference: string) {
      const id = aliases.get(reference) ?? reference;
      const matches = operations.filter((operation) => operation.id === id);
      if (matches.length !== 1) throw new Error(`Unknown or ambiguous compiled operation: ${reference}`);
      return matches[0];
    }
  });
}
