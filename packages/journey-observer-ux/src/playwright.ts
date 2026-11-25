import { toPlaywrightObservationLocator, type PlaywrightExecutionObserver, type PlaywrightOperationObservation } from "@openuji/journey-executor-playwright/observation";
import type { JourneyInputAction, JourneyObserverOutput } from "@openuji/journey-core";
import type { JourneyArtifactStore } from "@openuji/journey-plugin";
import type { RunResult } from "@openuji/journey-runner";
import { deriveUXOutput, immutableSnapshot, unmetExpectation, uxGeometryFormat, validateUXConfiguration, type UXConfiguration, type UXGeometry, type UXObservation, type UXProbe } from "./index.js";

/** Bounded stabilization for probes with expectations: re-read until two consecutive readings agree. */
const stabilization = Object.freeze({ reads: 10, intervalMs: 100 });

type Page = Extract<PlaywrightOperationObservation, { page: unknown }>["page"];
type Locator = Awaited<ReturnType<typeof toPlaywrightObservationLocator>>;

/**
 * One read of the target, the viewport and the page scroll. Every call is read-only: no scrolling,
 * focusing or hovering, so observing never changes what the next operation sees.
 */
async function readGeometry(page: Page, locator: Locator): Promise<Omit<UXGeometry, "stable"> & { visible: boolean }> {
  const matches = await locator.count();
  const visible = matches === 1 && await locator.isVisible();
  const box = visible ? await locator.boundingBox() : null;
  const window = await page.evaluate("({ width: innerWidth, height: innerHeight, x: scrollX, y: scrollY })") as { width: number; height: number; x: number; y: number };
  const viewport = page.viewportSize() ?? { width: window.width, height: window.height };
  return { matches, visible, rect: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null, viewport, scroll: { x: window.x, y: window.y } };
}

async function observeGeometry(page: Page, locator: Locator, stabilize: boolean): Promise<UXGeometry & { visible: boolean }> {
  let reading = await readGeometry(page, locator);
  if (!stabilize) return { ...reading, stable: true };
  for (let read = 1; read < stabilization.reads; read++) {
    await new Promise<void>((done) => setTimeout(done, stabilization.intervalMs));
    const next = await readGeometry(page, locator);
    if (JSON.stringify(next) === JSON.stringify(reading)) return { ...next, stable: true };
    reading = next;
  }
  return { ...reading, stable: false };
}

const contained = (geometry: UXGeometry) => !!(geometry.rect && geometry.viewport && geometry.rect.x >= 0 && geometry.rect.y >= 0
  && geometry.rect.x + geometry.rect.width <= geometry.viewport.width && geometry.rect.y + geometry.rect.height <= geometry.viewport.height);
const fileSegment = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_");

/**
 * `artifacts` stores the geometry record (and an optional viewport screenshot) of every probe that
 * declares expectations or a screenshot; without it, the facts stay in the observer output only.
 */
export function uxObserver(options: UXConfiguration, artifacts?: JourneyArtifactStore): PlaywrightExecutionObserver & {
  readonly evidence: readonly UXObservation[];
  output(result: RunResult): JourneyObserverOutput;
} {
  validateUXConfiguration(options);
  const config = immutableSnapshot(options);
  let facts: readonly UXObservation[] = Object.freeze([]);
  let actions: readonly JourneyInputAction[] = Object.freeze([]);

  async function record(observation: Extract<PlaywrightOperationObservation, { stage: "state-asserted" }>, probe: UXProbe, base: Omit<UXObservation, "files">): Promise<readonly string[]> {
    if (!artifacts || (!probe.expect?.length && !probe.screenshot)) return [];
    const scope = { runId: observation.execution.runId, executionId: observation.execution.executionId, profileId: observation.execution.profile.id, operationId: observation.operation.id };
    const name = `${fileSegment(config.id)}.${fileSegment(probe.id)}.${fileSegment(observation.execution.executionId)}`;
    const expectations = (probe.expect ?? []).map((expectation) => ({ expectation, met: !unmetExpectation(expectation, base) }));
    // Geometry is recorded before the screenshot, so capturing it cannot influence the measurement.
    const files = [(await artifacts.write({ name: `${name}.ux-geometry.json`, contentType: "application/json", format: uxGeometryFormat, scope,
      data: JSON.stringify({ format: uxGeometryFormat, version: 1, ...base, expectations }, null, 2) })).href];
    if (probe.screenshot) {
      const data = await observation.page.screenshot({ fullPage: false });
      files.push((await artifacts.write({ name: `${name}.viewport.png`, contentType: "image/png", scope, data })).href);
    }
    return files;
  }

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
        const { visible, ...geometry } = await observeGeometry(observation.page, locator, !!probe.expect?.length);
        const base = {
          runId: observation.execution.runId, executionId: observation.execution.executionId, profileId: observation.execution.profile.id,
          operationId: observation.operation.id, probeId: probe.id, targetOperationId: target.id, visible, inViewport: visible && contained(geometry), geometry
        };
        const files = await record(observation, probe, base);
        facts = Object.freeze([...facts, immutableSnapshot({ ...base, ...(files.length ? { files } : {}) })]);
      }
    },
    output(result) { return deriveUXOutput({ ...config, result, actions, observations: facts }); }
  };
}
