import { immutableSnapshot } from "@openuji/journey-core";
import { dirname, resolve } from "node:path";
import { type JourneyConfigContext, type JourneyArtifactStore, type JourneyPluginContext, type ObservationPublisher } from "@openuji/journey-plugin";
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
  /** Component-scoped identity for resource ownership. */
  componentId?: string;
  /** Omitted where no runtime observer runs, e.g. explicit `services up`. */
  observations?: ObservationPublisher;
}>;

/** Nothing subscribes outside a suite run, so producers always publish without checking for a port. */
const unobserved: ObservationPublisher = Object.freeze({ async publish() {} });

/** Every plugin context is built here, with its operation scope fixed at construction. */
export function pluginContext({ configPath, env, testId, artifacts, operations = [], aliases = new Map(), componentId = testId, observations = unobserved }: ContextInput): JourneyPluginContext {
  const scope = immutableSnapshot(operations);
  return Object.freeze({
    configPath, env: immutableSnapshot(env), testId, artifacts, operations: scope, componentId, observations,
    resolvePath: (path: string) => resolve(dirname(configPath), path),
    resolveOperation(reference: string) {
      const id = aliases.get(reference) ?? reference;
      const matches = scope.filter((operation) => operation.id === id);
      if (matches.length !== 1) throw new Error(`Unknown or ambiguous compiled operation: ${reference}`);
      return matches[0];
    }
  });
}

/** Drop runtime ports before calling any parser or preflight validator. */
export function configContext(context: JourneyPluginContext): JourneyConfigContext {
  const { artifacts: _artifacts, componentId: _componentId, observations: _observations, ...configuration } = context;
  return Object.freeze(configuration);
}

/** Preparation has no artifact side effects or mutable evidence registry. */
export const preflightArtifacts: JourneyArtifactStore = Object.freeze({
  files: Object.freeze([]),
  async write() { throw new Error("Evidence cannot be written during configuration preparation"); },
  async read() { throw new Error("Evidence cannot be read during configuration preparation"); }
});
