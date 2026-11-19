import type { ProfileModel, StepOutcome } from "@openuji/journey-reporter/model";

export type PathState = { id: string; journeyRef: string; type: "State"; label: string };
export type PathDocument = { journey: { id: string; label: string; entries: Record<string, { stateRef: string; label: string }>; defaultEntryRef: string; states: Record<string, PathState>; transitions: { id: string; label: string; from: string; to: string }[] } };
export type PathGraph = { document: PathDocument; states: Record<string, { outcome: StepOutcome; screenshot?: string; error?: string }> };
export type PathView = { title: string; profileId: string; graphs: PathGraph[] };

/** Project one profile's steps into the vendored journey-path display format: one linear graph per journey segment. */
export function projectJourneyPath(title: string, profile: ProfileModel, journeyItems: readonly string[] = []): PathView {
  const groups = new Map<string, ProfileModel["steps"][number][]>();
  for (const step of profile.steps) {
    const item = step.segment ?? "journey";
    if (journeyItems.length && !journeyItems.includes(item)) continue;
    groups.set(item, [...(groups.get(item) ?? []), step]);
  }
  const graphs: PathGraph[] = [];
  for (const [label, steps] of groups) {
    const states = steps.filter((step) => step.kind === "state");
    const nodes = states.length ? states : steps;
    if (!nodes.length) continue;
    const graphId = `display:${label}`;
    const graph: PathGraph = { document: { journey: { id: graphId, label, entries: { start: { stateRef: nodes[0].id, label } }, defaultEntryRef: "start", states: {}, transitions: [] } }, states: {} };
    for (const step of nodes) {
      graph.document.journey.states[step.id] = { id: step.id, type: "State", label: step.label, journeyRef: graphId };
      graph.states[step.id] = { outcome: step.outcome, ...(step.error ? { error: step.error } : {}), ...(step.screenshots[0] ? { screenshot: step.screenshots[0].href } : {}) };
    }
    for (let index = 1; index < nodes.length; index++) {
      const previous = nodes[index - 1]; const next = nodes[index];
      const between = steps.slice(steps.indexOf(previous) + 1, steps.indexOf(next));
      const labels = between.filter((step) => step.kind !== "state").map((step) => step.label);
      graph.document.journey.transitions.push({ id: `display-edge:${previous.id}:${next.id}`, label: labels.join(" / ") || "Continue", from: previous.id, to: next.id });
    }
    graphs.push(graph);
  }
  return { title, profileId: profile.id, graphs };
}
