import {
  knownOptions,
  optionsObject,
  requiredString,
  type JourneyMeshPlugin,
  type JourneyObserverComponent,
} from "@openuji/journey-runtime/plugin";
import {
  metricLandmarks,
  type MetricSelection,
  type UXProbe,
} from "./index.js";
import { uxObserver } from "./playwright.js";

function settings(options: Record<string, unknown>) {
  knownOptions(options, ["selection", "probes"]);
  const raw = optionsObject(options.selection, "selection");
  knownOptions(raw, [
    "journeyItemId",
    "startStateId",
    "acceptanceTransitionId",
    "completionStateId",
    "navigationTransitionIds",
  ]);
  for (const key of [
    "journeyItemId",
    "startStateId",
    "acceptanceTransitionId",
    "completionStateId",
  ])
    requiredString(raw[key], key);
  if (
    !Array.isArray(raw.navigationTransitionIds) ||
    raw.navigationTransitionIds.some((id) => typeof id !== "string")
  )
    throw new Error("navigationTransitionIds must be a string array");
  if (!Array.isArray(options.probes))
    throw new Error("probes must be an array");
  const probes = options.probes.map((value) => {
    const probe = optionsObject(value, "probe");
    knownOptions(probe, ["id", "atStateId", "targetGraphNodeId"]);
    return Object.fromEntries(
      ["id", "atStateId", "targetGraphNodeId"].map((key) => [
        key,
        requiredString(probe[key], key),
      ]),
    ) as UXProbe;
  });
  if (new Set(probes.map((p) => p.id)).size !== probes.length)
    throw new Error("Probe IDs must be unique");
  return { selection: raw as unknown as MetricSelection, probes };
}

export const journeyMeshPlugin: JourneyMeshPlugin<JourneyObserverComponent> = {
  apiVersion: 1,
  kind: "observer",
  runtime: "playwright",
  validate(options, context) {
    const config = settings(options);
    metricLandmarks(context.operations, config.selection);
    for (const probe of config.probes) {
      const scoped = context.operations.filter(
        (op) =>
          op.source?.references?.journeyItemId ===
          config.selection.journeyItemId,
      );
      if (
        !scoped.some(
          (op) => op.kind === "state" && op.state.id === probe.atStateId,
        ) ||
        !scoped.some((op) =>
          op.kind === "state"
            ? op.state.id === probe.targetGraphNodeId
            : op.transition.id === probe.targetGraphNodeId,
        )
      )
        throw new Error(`Unknown probe landmark: ${probe.id}`);
    }
  },
  create(options, context) {
    const observer = uxObserver({
      ...settings(options),
      operations: context.operations,
      artifacts: context.artifacts,
    });
    return { observer, reporter: observer };
  },
};
