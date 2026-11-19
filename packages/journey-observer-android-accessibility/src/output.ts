import type { JourneyObserverOutput } from "@openuji/journey-core";
import type { AndroidAccessibilityEvidence } from "./evidence.js";
import { androidAccessibilityKind } from "./classify.js";

/** What the Android accessibility observer records for a test: capture settings and the journal. */
export type AndroidRecordedEvidence = Readonly<{
  reportId: string;
  createdAt: string;
  strict: boolean;
  journal: readonly AndroidAccessibilityEvidence[];
}>;

export type AndroidAccessibilityObserverOutput = JourneyObserverOutput & {
  kind: typeof androidAccessibilityKind;
  evidence: AndroidRecordedEvidence;
};

/** Recorded outputs are plain JSON: check the shape before relying on it. */
export function isAndroidAccessibilityOutput(output: JourneyObserverOutput): output is AndroidAccessibilityObserverOutput {
  const evidence = output.evidence as Partial<AndroidRecordedEvidence> | null;
  return output.kind === androidAccessibilityKind && !!evidence && Array.isArray(evidence.journal) && typeof evidence.reportId === "string";
}
