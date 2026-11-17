import {
  toPlaywrightObservationLocator,
  type PlaywrightExecutionObserver,
} from "@openuji/journey-adapter-playwright";
import type { JourneyPlanOperation } from "@openuji/journey-execution-model";
import type { JourneyReporter } from "@openuji/journey-runner";
import type { JourneyArtifactStore } from "@openuji/journey-runtime/plugin";
import {
  deriveJourneyMetrics,
  graphNodeId,
  immutableSnapshot,
  type MetricSelection,
  type UXObservation,
  type UXProbe,
} from "./index.js";

export function uxObserver(
  options: Readonly<{
    operations: readonly JourneyPlanOperation[];
    selection: MetricSelection;
    probes: readonly UXProbe[];
    artifacts: JourneyArtifactStore;
  }>,
): PlaywrightExecutionObserver &
  JourneyReporter & { readonly evidence: readonly UXObservation[] } {
  const config = immutableSnapshot({
    operations: options.operations,
    selection: options.selection,
    probes: options.probes,
  });
  // The only accumulation boundary. Facts never retain Page or Locator handles.
  let facts: readonly UXObservation[] = Object.freeze([]);
  return {
    name: "@openuji/journey-observer-ux",
    get evidence() {
      return facts;
    },
    async observeOperation(observation) {
      if (observation.stage !== "state-asserted") return;
      if (
        observation.operation.source?.references?.journeyItemId !==
        config.selection.journeyItemId
      )
        return;
      for (const probe of config.probes.filter(
        (p) => p.atStateId === observation.operation.state.id,
      )) {
        const target = config.operations.find(
          (op) =>
            graphNodeId(op) === probe.targetGraphNodeId &&
            op.source?.references?.journeyItemId ===
              config.selection.journeyItemId,
        );
        if (!target || target.kind === "control-flow")
          throw new Error(
            `UX probe target is not observable: ${probe.targetGraphNodeId}`,
          );
        const bindings =
          target.kind === "state"
            ? target.target.bindings
            : target.activation.bindings;
        const locator = await toPlaywrightObservationLocator(
          observation.page,
          bindings,
        );
        const visible =
          (await locator.count()) === 1 && (await locator.isVisible());
        const box = visible ? await locator.boundingBox() : null;
        const viewport = observation.page.viewportSize();
        const fact = immutableSnapshot({
          runId: observation.execution.runId,
          executionId: observation.execution.executionId,
          profileId: observation.execution.profile.id,
          operationId: observation.operation.id,
          graphNodeId: graphNodeId(observation.operation),
          probeId: probe.id,
          targetGraphNodeId: probe.targetGraphNodeId,
          visible,
          inViewport: !!(
            box &&
            viewport &&
            box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= viewport.width &&
            box.y + box.height <= viewport.height
          ),
        });
        facts = Object.freeze([...facts, fact]);
      }
    },
    async report({ result }) {
      const document = immutableSnapshot({
        format: "journey-mesh/ux/v1",
        runId: result.runId,
        selection: config.selection,
        operations: config.operations,
        profiles: deriveJourneyMetrics({
          operations: config.operations,
          result,
          observations: facts,
          selection: config.selection,
        }),
      });
      await options.artifacts.write({
        name: "ux-metrics.json",
        data: JSON.stringify(document, null, 2),
        contentType: "application/json",
      });
    },
  };
}
