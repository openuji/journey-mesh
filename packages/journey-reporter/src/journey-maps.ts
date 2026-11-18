import { Registry, type UJGDocument } from "@openuji/journey-path/registry";
import type { JourneySegment, TestResultBundle } from "@openuji/journey-plugin";
import type { JourneyRunError } from "@openuji/journey-runner";

export type JourneyMapSelection = Readonly<{ view: string; segments: readonly JourneySegment[]; rootStartIds: string[] }>;

/** Re-publishing an older run must also expose map failures without rewriting execution history. */
export function withJourneyMapErrors(test: TestResultBundle): TestResultBundle {
  const errors = selectJourneyMaps(test).errors.filter((error) => !test.reportingErrors.some((item) => item.name === error.name && item.message === error.message));
  return errors.length ? { ...test, reportingErrors: [...test.reportingErrors, ...errors] } : test;
}

/** Validate with the same registry as the viewer; never derive topology from execution order. */
export function selectJourneyMaps(test: TestResultBundle): { maps: JourneyMapSelection[]; errors: JourneyRunError[] } {
  const byView = new Map<string, JourneySegment[]>();
  const errors: JourneyRunError[] = [];
  const maps: JourneyMapSelection[] = [];
  const excluded = new Set(test.report?.excludedPhaseIds ?? []);
  for (const segment of test.segments ?? []) {
    if (!segment.view) continue;
    if (!test.views?.[segment.view]) {
      errors.push({ name: "JourneyMapError", message: `Journey map ${segment.view}: view is missing for segment ${segment.id}` });
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
      errors.push({ name: "JourneyMapError", message: `Journey map ${view}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return { maps, errors };
}
