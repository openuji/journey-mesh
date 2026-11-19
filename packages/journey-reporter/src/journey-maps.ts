import { Registry, type UJGDocument } from "@openuji/journey-path/registry";
import type { JourneySegment, TestRecord } from "@openuji/journey-run-record";

export type JourneyMapSelection = Readonly<{ view: string; segments: readonly JourneySegment[]; rootStartIds: string[] }>;

/**
 * Which journey-map views of a test can be drawn, and from which root entries, after phase exclusions.
 * Uses the same registry as the renderer; never derives topology from execution order. Problems are
 * reported, never thrown: a broken map is a reporting problem, not a test failure.
 */
export function selectJourneyMaps(test: Pick<TestRecord, "segments" | "views">, excludedPhaseIds: readonly string[] = []): { maps: JourneyMapSelection[]; errors: string[] } {
  const byView = new Map<string, JourneySegment[]>();
  const errors: string[] = [];
  const maps: JourneyMapSelection[] = [];
  const excluded = new Set(excludedPhaseIds);
  for (const segment of test.segments ?? []) {
    if (!segment.view) continue;
    if (!test.views?.[segment.view]) {
      errors.push(`Journey map ${segment.view}: view is missing for segment ${segment.id}`);
      continue;
    }
    if (test.views[segment.view].format !== "journey-map") continue;
    byView.set(segment.view, [...(byView.get(segment.view) ?? []), segment]);
  }
  for (const [view, segments] of byView) {
    try {
      const document = test.views[view].document as UJGDocument;
      if (!document || (!document.journey && !document.journeyEntryIndex)) throw new Error("no root journey or JourneyEntryIndex; the view has no discoverable entries");
      const registry = new Registry(structuredClone(document));
      const starts = registry.getRootStartOptions();
      const visible = segments.flatMap((segment) => {
        const selected = starts.filter((start) => {
          const state = registry.states.get(start.stateRef);
          return (state?.subjourney?.id ?? state?.journeyOwnerRef) === segment.journeyId;
        });
        if (!selected.length) throw new Error(`journey ${segment.journeyId} has no discoverable entry`);
        return selected.filter((start) => !excluded.has(registry.getPhaseForState(start.stateRef)?.id ?? ""))
          .map((start) => ({ segment, start }));
      });
      if (visible.length) maps.push({ view, segments: [...new Set(visible.map(({ segment }) => segment))], rootStartIds: [...new Set(visible.map(({ start }) => start.id))] });
    } catch (error) {
      errors.push(`Journey map ${view}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { maps, errors };
}
