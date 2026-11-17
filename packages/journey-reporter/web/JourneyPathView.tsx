import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { JourneyPath, Registry, type UJGDocument } from "@openuji/journey-path";
import type { TestResultBundle } from "@openuji/journey-plugin";
import { projectJourneyPath, type PathView } from "../src/journey-path.js";

type Graph = PathView["graphs"][number];

function Diagram({ graph, base, label }: { graph: Graph; base: string; label: string }) {
  const root = useRef<HTMLDivElement>(null);
  const registry = useMemo(() => new Registry(structuredClone(graph.document) as UJGDocument), [graph]);
  const previews = { states: Object.fromEntries(Object.entries(graph.states).map(([id, state]) => [id, { sourceScreenshotHref: state.screenshot ? base + state.screenshot : undefined }])) };
  useLayoutEffect(() => {
    root.current?.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => {
      const state = graph.states[element.dataset.nodeId!];
      if (!state) return;
      element.dataset.outcome = state.outcome;
      element.dataset.statusLabel = state.outcome === "unexecuted" ? "Not executed" : state.outcome === "failed" ? "Failed" : "Passed";
      element.title = state.error ?? element.dataset.statusLabel;
    });
  }, [graph]);
  return <div ref={root} data-journey-segment={graph.document.journey.label}>
    <JourneyPath block registry={registry} accessibilityDocument={previews} className="path-root" ariaLabel={`${label}, planned and executed journey`} />
  </div>;
}

/** Planned states and recorded outcomes of one execution, projected client-side from the saved bundle. */
export function JourneyPathView({ test, profile, base = "", label }: { test: TestResultBundle; profile: string; base?: string; label: string }) {
  const segments = useMemo(() => [...new Set(test.plan.operations.flatMap((operation) => operation.segment ? [operation.segment] : []))], [test]);
  const [segment, setSegment] = useState("");
  const view = useMemo(() => projectJourneyPath(test, profile, segment ? [segment] : []), [test, profile, segment]);
  const id = `segment-${label}-${profile}`.replace(/[^A-Za-z0-9_-]/g, "-");
  return <div className="journey-path" data-journey-path={profile}>
    {segments.length > 1 && <div className="segment-control"><label htmlFor={id}>Journey</label>
      <select id={id} value={segment} onChange={(event) => setSegment(event.target.value)}>
        <option value="">All journeys</option>
        {segments.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </div>}
    {view.graphs.length
      ? view.graphs.map((graph) => <Diagram key={graph.document.journey.id} graph={graph} base={base} label={`${label}, ${profile}, ${graph.document.journey.label}`} />)
      : <p className="empty">No planned operations match this view.</p>}
    <p className="diagram-caption">Planned states and recorded outcomes. Focus or hover a captured state to preview its screenshot.</p>
  </div>;
}
