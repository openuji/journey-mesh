import { toPlaywrightObservationLocator, type PlaywrightExecutionObserver } from "@openuji/journey-adapter-playwright";
import type { JourneyInputAction, JourneyObserverOutput } from "@openuji/journey-core";
import type { RunResult } from "@openuji/journey-runner";
import { deriveUXOutput, immutableSnapshot, validateUXConfiguration, type UXConfiguration, type UXObservation } from "./index.js";

export function uxObserver(options: UXConfiguration): PlaywrightExecutionObserver & {
  readonly evidence: readonly UXObservation[];
  output(result: RunResult): JourneyObserverOutput;
} {
  validateUXConfiguration(options);
  const config = immutableSnapshot(options);
  let facts: readonly UXObservation[] = Object.freeze([]);
  let actions: readonly JourneyInputAction[] = Object.freeze([]);
  return {
    name: "@openuji/journey-observer-ux",
    get evidence() { return facts; },
    onAction(action) { actions = Object.freeze([...actions, immutableSnapshot(action)]); },
    async observeOperation(observation) {
      if (observation.stage !== "state-asserted") return;
      for (const probe of config.probes.filter((item) => item.at === observation.operation.id)) {
        const target = config.operations.find((op) => op.id === probe.target)!;
        if (target.kind === "control-flow") throw new Error(`Probe target is not observable: ${probe.target}`);
        const locator = await toPlaywrightObservationLocator(observation.page, target.kind === "state" ? target.target.bindings : target.activation.bindings);
        const visible = (await locator.count()) === 1 && await locator.isVisible();
        const box = visible ? await locator.boundingBox() : null;
        const viewport = observation.page.viewportSize();
        const fact = immutableSnapshot({
          runId: observation.execution.runId, executionId: observation.execution.executionId, profileId: observation.execution.profile.id,
          operationId: observation.operation.id, probeId: probe.id, targetOperationId: target.id, visible,
          inViewport: !!(box && viewport && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height)
        });
        facts = Object.freeze([...facts, fact]);
      }
    },
    output(result) { return deriveUXOutput({ ...config, result, actions, observations: facts }); }
  };
}
