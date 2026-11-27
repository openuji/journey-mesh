import type { JourneyObserverOutput } from "@openuji/journey-core";
import type { IosAccessibilityEvidence } from "./evidence.js";
import { iosAccessibilityKind } from "./classify.js";

/** What the iOS accessibility observer records for a test: capture settings and the journal. */
export type IosRecordedEvidence = Readonly<{
  reportId: string;
  createdAt: string;
  strict: boolean;
  journal: readonly IosAccessibilityEvidence[];
}>;

export type IosAccessibilityObserverOutput = JourneyObserverOutput & {
  kind: typeof iosAccessibilityKind;
  evidence: IosRecordedEvidence;
};

/** Recorded outputs are plain JSON: check the shape before relying on it. */
export function isIosAccessibilityOutput(output: JourneyObserverOutput): output is IosAccessibilityObserverOutput {
  const evidence = output.evidence as Partial<IosRecordedEvidence> | null;
  return (
    output.kind === iosAccessibilityKind &&
    !!evidence &&
    Array.isArray(evidence.journal) &&
    typeof evidence.reportId === "string"
  );
}
