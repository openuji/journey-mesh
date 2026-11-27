import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { JourneyPath, ResponsiveJourneyPath, Registry, type JourneyPathPreviewData, type UJGDocument } from "@openuji/journey-path";
import type { JourneyMapModel, LoadedReport, MapState, ProfileModel, TestModel } from "@openuji/journey-reporter/model";
import { JourneyPathView } from "./JourneyPathView.js";
import { fileUrl } from "./ui.js";

type MapInput = { test: TestModel; profile: ProfileModel; report: LoadedReport; label: string };

/** The map overlay for the vendored renderer: outcomes, metrics and screenshots by model state ID. */
function preview(states: Readonly<Record<string, MapState>>, report: LoadedReport): JourneyPathPreviewData {
  return { states: Object.fromEntries(Object.entries(states).map(([id, state]) => [id, {
    id,
    ...(state.metrics && state.metrics.kind !== "skipped" ? { status: "audited" as const, metrics: state.metrics as never } : { status: "skipped" as const }),
    ...(state.screenshot ? { sourceScreenshotHref: fileUrl(report, state.screenshot) } : {})
  }])) } as JourneyPathPreviewData;
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

const platformLabel = (executor: string) => executor === "ios" ? "iOS" : executor.charAt(0).toUpperCase() + executor.slice(1);

/** `block` is injected by `ResponsiveJourneyPath` below its breakpoint. */
function JourneyDocument({ registry, map, states, touchpointLabels, report, label, profile, block = false }: {
  registry: Registry; map: JourneyMapModel; states: Readonly<Record<string, MapState>>; touchpointLabels: ReadonlyMap<string, string>;
  report: LoadedReport; label: string; profile: string; block?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const starts = registry.getRootStartOptions().filter((start) => map.rootStartIds.includes(start.id));
  const controls: Record<string, ReactNode> = {};
  for (const start of starts) {
    for (const touchpoint of registry.getJourneyProperties(start.stateRef).touchpoints) {
      controls[touchpoint.id] = <TouchpointChip label={touchpoint.label ?? touchpointLabels.get(touchpoint.id) ?? touchpoint.id} platforms={(map.touchpoints[touchpoint.id] ?? []).map(platformLabel)} />;
    }
  }
  useLayoutEffect(() => {
    root.current?.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => {
      const state = states[element.dataset.nodeId!];
      if (!state) return;
      element.dataset.outcome = state.outcome;
      if (state.outcome !== "passed") element.title = state.error ?? "Not executed";
    });
  });
  if (!starts.length) return null;
  return <div ref={root} className="journey-document">
    <JourneyPath block={block} registry={registry} rootStartIds={starts.map((start) => start.id)} accessibilityDocument={preview(states, report)}
      touchpointControls={controls} className="journey-path-island" ariaLabel={`${label}, ${profile}: planned journey with recorded outcomes`} />
  </div>;
}

/** The journey map of one execution: the model's own journey documents with outcomes and metrics on each node. */
export function JourneyMap({ test, profile, report, label }: MapInput) {
  const [documents, setDocuments] = useState<Record<string, UJGDocument>>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    const views = [...new Set(test.maps.map((map) => map.view))];
    Promise.all(views.map(async (view) => [view, (await report.readJson<{ document: UJGDocument }>(test.views[view].href)).document] as const))
      .then((entries) => { if (!cancelled) setDocuments(Object.fromEntries(entries)); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [test, report]);
  const maps = useMemo(() => documents ? test.maps.map((map) => ({ map, registry: new Registry(structuredClone(documents[map.view])) })) : [], [documents, test]);
  // A document without touchpoint labels (e.g. a setup fragment) borrows them from the test's other documents.
  const touchpointLabels = useMemo(() => new Map(maps.flatMap(({ registry }) => [...registry.touchpoints].flatMap(([id, touchpoint]) => touchpoint.label ? [[id, touchpoint.label] as const] : []))), [maps]);
  const hasMap = Object.values(test.views).some((view) => view.format === "journey-map");
  if (!hasMap) return <JourneyPathView test={test} profile={profile} report={report} label={label} />;
  const errors = [...test.mapErrors, ...(error ? [error] : [])];
  return <div className="journey-map" data-journey-map={profile.id}>
    {errors.length > 0 && <div role="alert"><p>Journey map could not be rendered.</p><ul className="errors">{errors.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    {!documents && !error && test.maps.length > 0 && <p role="status">Loading journey map…</p>}
    {maps.map(({ map, registry }) => <ResponsiveJourneyPath breakpoint={900} key={map.view}>
      <JourneyDocument registry={registry} map={map} states={profile.mapStates[map.view] ?? {}} touchpointLabels={touchpointLabels} report={report} label={label} profile={profile.id} />
    </ResponsiveJourneyPath>)}
    {!test.maps.length && !test.mapErrors.length && <p className="empty">All selected journeys are excluded from this report by its phase settings.</p>}
  </div>;
}

export function MetricsLegend({ kinds }: { kinds: ReadonlySet<string> }) {
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
        <strong>Native · hierarchy</strong>
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
          <div><dt><span className="metric-legend-token metric-legend-not-executed">Dashed</span></dt><dd>The run ended before this state.</dd></div>
        </dl>
      </div>
    </div>
  </section>;
}
