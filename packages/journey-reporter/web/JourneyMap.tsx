import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { JourneyPath, ResponsiveJourneyPath, Registry, type JourneyPathPreviewData, type UJGDocument } from "@openuji/journey-path";
import type { JourneyNodeMetrics } from "@openuji/journey-core";
import type { JourneySegment, TestResultBundle } from "@openuji/journey-plugin";
import { artifactHref } from "../src/paths.js";
import { JourneyPathView } from "./JourneyPathView.js";

type Outcome = "passed" | "failed" | "unexecuted";
type MapInput = { test: TestResultBundle; profile: string; base: string; label: string };

/** Node metrics, screenshots and outcomes of one execution, keyed by the model's state IDs. */
function executionView(test: TestResultBundle, profile: string, base: string, segments: ReadonlySet<string>) {
  const execution = test.result.executions.find((item) => item.profileId === profile);
  const recorded = test.result.evidence.executions.find((item) => item.executionId === execution?.executionId);
  const nodes = test.outputs.flatMap((output) => output.nodes ?? []).filter((node) => node.executionId === execution?.executionId);
  const preview: Required<JourneyPathPreviewData>["states"] = {};
  const outcomes = new Map<string, { outcome: Outcome; error?: string }>();
  for (const operation of test.plan.operations) {
    if (operation.kind !== "state" || !segments.has(operation.segment ?? "")) continue;
    const id = operation.state.id;
    const result = recorded?.operations.find((item) => item.operationId === operation.id)?.outcome;
    outcomes.set(id, { outcome: result?.kind ?? "unexecuted", ...(result?.kind === "failed" ? { error: result.error.message } : {}) });
    const metrics: JourneyNodeMetrics | undefined = nodes.find((node) => node.operationId === operation.id)?.metrics;
    const screenshot = test.artifacts.find((artifact) => artifact.contentType === "image/png" && !!artifact.scope && artifact.scope.executionId === execution?.executionId && artifact.scope.operationId === operation.id);
    preview[id] = {
      id,
      ...(metrics?.kind === "skipped" ? { status: "skipped" as const } : metrics ? { status: "audited" as const, metrics } : {}),
      ...(screenshot ? { sourceScreenshotHref: base + artifactHref(screenshot.href) } : {})
    };
  }
  return { preview: { states: preview }, outcomes };
}

function TouchpointChip({ label, platforms }: { label: string; platforms: readonly string[] }) {
  return <span className="journey-client-control journey-client-control--segmented">
    <span className="journey-client-label">
      <svg aria-hidden="true" fill="none" viewBox="0 0 16 16"><path d="M4.7 11.5h6.4a2.4 2.4 0 0 0 .3-4.8 3.7 3.7 0 0 0-7.1-1.1A3 3 0 0 0 4.7 11.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
      <span>{label}</span>
    </span>
    {platforms.map((platform) => <span className="journey-client-option journey-client-option--active" key={platform}>{platform}</span>)}
  </span>;
}

const platformLabel = (adapter: string) => adapter.charAt(0).toUpperCase() + adapter.slice(1);

function JourneyDocument({ registry, segments, touchpointLabels, block = false, ...input }: MapInput & { registry: Registry; segments: readonly JourneySegment[]; touchpointLabels: ReadonlyMap<string, string>; block?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const { test, profile, base, label } = input;
  const segmentIds = useMemo(() => new Set(segments.map((segment) => segment.id)), [segments]);
  const journeyIds = new Set(segments.map((segment) => segment.journeyId));
  const starts = registry.getRootStartOptions().filter((start) => journeyIds.has(registry.states.get(start.stateRef)?.subjourney?.id ?? ""));
  const { preview, outcomes } = useMemo(() => executionView(test, profile, base, segmentIds), [test, profile, base, segmentIds]);
  const controls: Record<string, ReactNode> = {};
  for (const start of starts) {
    for (const touchpoint of registry.getJourneyProperties(start.stateRef).touchpoints) {
      const platforms = [...new Set(test.plan.operations
        .filter((operation) => operation.touchpointId === touchpoint.id && segmentIds.has(operation.segment ?? ""))
        .flatMap((operation) => segments.filter((segment) => segment.id === operation.segment).map((segment) => platformLabel(segment.adapter))))];
      controls[touchpoint.id] = <TouchpointChip label={touchpoint.label ?? touchpointLabels.get(touchpoint.id) ?? touchpoint.id} platforms={platforms} />;
    }
  }
  useLayoutEffect(() => {
    root.current?.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => {
      const state = outcomes.get(element.dataset.nodeId!);
      if (!state) return;
      element.dataset.outcome = state.outcome;
      if (state.outcome !== "passed") element.title = state.error ?? "Not executed";
    });
  });
  if (!starts.length) return null;
  return <div ref={root} className="journey-document">
    <JourneyPath block={block} registry={registry} rootStartIds={starts.map((start) => start.id)} accessibilityDocument={preview}
      touchpointControls={controls} className="journey-path-island" ariaLabel={`${label}, ${profile}: planned journey with recorded outcomes`} />
  </div>;
}

/** Registries for the test's embedded journey maps; a view the renderer rejects is left out. */
function useRegistries(test: TestResultBundle): readonly (readonly [Registry, readonly JourneySegment[]])[] {
  return useMemo(() => {
    const byView = new Map<string, JourneySegment[]>();
    for (const segment of test.segments ?? []) {
      if (!segment.view || test.views?.[segment.view]?.format !== "journey-map") continue;
      byView.set(segment.view, [...(byView.get(segment.view) ?? []), segment]);
    }
    return [...byView].flatMap(([key, segments]) => {
      try { return [[new Registry(structuredClone(test.views[key].document) as UJGDocument), segments] as const]; }
      catch { return []; }
    });
  }, [test]);
}

/** The journey map of one execution: the model's own journey documents with outcomes and observer metrics on each node. */
export function JourneyMap(input: MapInput) {
  const maps = useRegistries(input.test);
  // A document without touchpoint labels (e.g. a setup fragment) borrows them from the test's other documents.
  const touchpointLabels = useMemo(() => new Map(maps.flatMap(([registry]) => [...registry.touchpoints].flatMap(([id, touchpoint]) => touchpoint.label ? [[id, touchpoint.label] as const] : []))), [maps]);
  if (!maps.length) return <JourneyPathView {...input} />;
  return <div className="journey-map" data-journey-map={input.profile}>
    {maps.map(([registry, segments]) => <ResponsiveJourneyPath breakpoint={900} key={segments[0].view}>
      <JourneyDocument {...input} registry={registry} segments={segments} touchpointLabels={touchpointLabels} />
    </ResponsiveJourneyPath>)}
  </div>;
}

/** Which footer metric kinds a test shows, so the legend explains only what is on screen. */
export function metricKinds(test: TestResultBundle): ReadonlySet<JourneyNodeMetrics["kind"]> {
  return new Set(test.outputs.flatMap((output) => output.nodes ?? []).map((node) => node.metrics.kind));
}

export function MetricsLegend({ kinds }: { kinds: ReadonlySet<JourneyNodeMetrics["kind"]> }) {
  if (!kinds.size) return null;
  return <section aria-labelledby="metrics-legend-title" className="accessibility-metrics-legend">
    <h2 id="metrics-legend-title">Accessibility metrics legend</h2>
    <div className="metric-legend-groups">
      {kinds.has("axe") && <div className="metric-legend-group">
        <strong>Browser · axe</strong>
        <dl>
          <div><dt><span className="metric-legend-token">P</span></dt><dd>Full-page audit at the journey state.</dd></div>
          <div><dt><span className="metric-legend-token">S</span></dt><dd>Audit scoped to the matched UI surface.</dd></div>
          <div><dt><span className="metric-legend-token">V · I</span></dt><dd>Violations and incomplete checks needing review.</dd></div>
          <div><dt><span className="metric-legend-token metric-legend-clean"><span aria-hidden="true">✓</span> CLEAN</span></dt><dd>Zero violations and zero incomplete checks.</dd></div>
        </dl>
      </div>}
      {kinds.has("native") && <div className="metric-legend-group">
        <strong>Android · native hierarchy</strong>
        <dl>
          <div><dt><span className="metric-legend-token metric-legend-review">F</span></dt><dd>Hierarchy findings that require manual review.</dd></div>
          <div><dt><span className="metric-legend-token metric-legend-pass">P</span></dt><dd>Passed native hierarchy checks. Here P means passes, not page.</dd></div>
        </dl>
      </div>}
      <div className="metric-legend-group">
        <strong>Execution</strong>
        <dl>
          <div><dt><span className="metric-legend-token">SKIPPED</span></dt><dd>No metrics were recorded for the state.</dd></div>
          <div><dt><span className="metric-legend-token metric-legend-failed">Failed</span></dt><dd>The state was not reached; hover it for the error.</dd></div>
          <div><dt><span className="metric-legend-token metric-legend-unexecuted">Dashed</span></dt><dd>The run ended before this state.</dd></div>
        </dl>
      </div>
    </div>
  </section>;
}
