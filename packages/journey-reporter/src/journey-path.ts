import { immutableSnapshot, type Immutable } from "@openuji/journey-core";
import type { TestResultBundle } from "@openuji/journey-plugin";

type PlanOperation = TestResultBundle["plan"]["operations"][number];
export type PathState = { id: string; journeyRef: string; type: "State"; label: string };
export type PathDocument = { journey: { id: string; label: string; entries: Record<string, { stateRef: string; label: string }>; defaultEntryRef: string; states: Record<string, PathState>; transitions: { id: string; label: string; from: string; to: string }[] } };
type PathViewData = { title: string; profileId: string; graphs: { document: PathDocument; states: Record<string, { outcome: "passed" | "failed" | "unexecuted"; screenshot?: string; error?: string }> }[] };
export type PathView = Immutable<PathViewData>;

/** Translate a saved test into the vendored journey-path display format: one linear graph per journey segment. */
export function projectJourneyPath(test: TestResultBundle, profileId: string, journeyItems: readonly string[] = []): PathView {
  const execution = test.result.evidence.executions.find((item) => item.profileId === profileId);
  const groups = new Map<string, PlanOperation[]>();
  for (const operation of test.plan.operations) {
    const item = operation.segment ?? "journey";
    if (journeyItems.length && !journeyItems.includes(item)) continue;
    const group = groups.get(item) ?? []; group.push(operation); groups.set(item, group);
  }
  const outcome = (id: string) => execution?.operations.find((item) => item.operationId === id)?.outcome;
  const graphs: PathViewData["graphs"] = [];
  for (const [title, operations] of groups) {
    const states = operations.filter((operation) => operation.kind === "state");
    const nodes = states.length ? states : operations;
    if (!nodes.length) continue;
    const graphId = `display:${title}`;
    const graph: PathViewData["graphs"][number] = { document: { journey: { id: graphId, label: title, entries: { start: { stateRef: nodes[0].id, label: title } }, defaultEntryRef: "start", states: {}, transitions: [] } }, states: {} };
    for (const operation of nodes) {
      const label = operation.kind === "state" ? operation.state.label ?? operation.state.id : operation.transition.label ?? "Continue";
      graph.document.journey.states[operation.id] = { id: operation.id, type: "State", label, journeyRef: graphId };
      const result = outcome(operation.id);
      const artifact = test.artifacts.find((item) => item.contentType === "image/png" && item.scope?.runId === test.result.runId && item.scope.executionId === execution?.executionId && item.scope.profileId === profileId && item.scope.operationId === operation.id);
      graph.states[operation.id] = { outcome: result?.kind ?? "unexecuted", ...(result?.kind === "failed" ? { error: result.error.message } : {}), ...(artifact ? { screenshot: artifact.href.split("/").map(encodeURIComponent).join("/") } : {}) };
    }
    for (let index = 1; index < nodes.length; index++) {
      const previous = nodes[index - 1]; const next = nodes[index];
      const between = operations.slice(operations.indexOf(previous) + 1, operations.indexOf(next));
      const labels = between.filter((operation) => operation.kind !== "state").map((operation) => operation.transition.label ?? "Continue");
      graph.document.journey.transitions.push({ id: `display-edge:${previous.id}:${next.id}`, label: labels.join(" / ") || "Continue", from: previous.id, to: next.id });
    }
    graphs.push(graph);
  }
  return immutableSnapshot({ title: test.id, profileId, graphs });
}
