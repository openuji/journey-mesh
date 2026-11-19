import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { JourneyPath, Registry, type UJGDocument } from "@openuji/journey-path";
import type { LoadedReport, ProfileModel, TestModel } from "@openuji/journey-reporter/model";
import { projectJourneyPath, type PathGraph } from "./journey-path.js";
import { fileUrl } from "./ui.js";

const statusLabels = { "not-executed": "Not executed", failed: "Failed", passed: "Passed" } as const;

function Diagram({ graph, report, label }: { graph: PathGraph; report: LoadedReport; label: string }) {
  const root = useRef<HTMLDivElement>(null);
  const registry = useMemo(() => new Registry(structuredClone(graph.document) as UJGDocument), [graph]);
  const previews = { states: Object.fromEntries(Object.entries(graph.states).map(([id, state]) => [id, { sourceScreenshotHref: state.screenshot ? fileUrl(report, state.screenshot) : undefined }])) };
  useLayoutEffect(() => {
    root.current?.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => {
      const state = graph.states[element.dataset.nodeId!];
      if (!state) return;
      element.dataset.outcome = state.outcome;
      element.dataset.statusLabel = statusLabels[state.outcome];
      element.title = state.error ?? element.dataset.statusLabel;
    });
  }, [graph]);
  return <div ref={root} data-journey-segment={graph.document.journey.label}>
    <JourneyPath block registry={registry} accessibilityDocument={previews} className="path-root" ariaLabel={`${label}, planned and executed journey`} />
  </div>;
}

/** Planned states and recorded outcomes of one execution, for tests whose model has no journey map. */
export function JourneyPathView({ test, profile, report, label }: { test: TestModel; profile: ProfileModel; report: LoadedReport; label: string }) {
  const segments = useMemo(() => [...new Set(profile.steps.flatMap((step) => step.segment ? [step.segment] : []))], [profile]);
  const [segment, setSegment] = useState("");
  const view = useMemo(() => projectJourneyPath(test.id, profile, segment ? [segment] : []), [test, profile, segment]);
  const id = `segment-${label}-${profile.id}`.replace(/[^A-Za-z0-9_-]/g, "-");
  return <div className="journey-path" data-journey-path={profile.id}>
    {segments.length > 1 && <div className="segment-control"><label htmlFor={id}>Journey</label>
      <select id={id} value={segment} onChange={(event) => setSegment(event.target.value)}>
        <option value="">All journeys</option>
        {segments.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </div>}
    {view.graphs.length
      ? view.graphs.map((graph) => <Diagram key={graph.document.journey.id} graph={graph} report={report} label={`${label}, ${profile.id}, ${graph.document.journey.label}`} />)
      : <p className="empty">No planned operations match this view.</p>}
    <p className="diagram-caption">Planned states and recorded outcomes. Focus or hover a captured state to preview its screenshot.</p>
  </div>;
}
