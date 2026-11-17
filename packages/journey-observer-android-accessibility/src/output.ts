import type { JourneyObserverOutput } from "@openuji/journey-core";
import type { AndroidAccessibilityEvidence } from "./evidence.js";
import type { AndroidAccessibilityReport } from "./report.js";

/** What the Android accessibility observer contributes to a test bundle. */
export type AndroidAccessibilityObserverOutput = JourneyObserverOutput & {
  kind: "android-accessibility";
  evidence: Readonly<{ journal: readonly AndroidAccessibilityEvidence[]; report: AndroidAccessibilityReport }>;
};

/** Saved bundles are plain JSON: check the shape before the reporter relies on it. */
export function isAndroidAccessibilityOutput(output: JourneyObserverOutput): output is AndroidAccessibilityObserverOutput {
  const evidence = output.evidence as { journal?: unknown; report?: { format?: unknown } } | null;
  return output.kind === "android-accessibility" && !!evidence && Array.isArray(evidence.journal) && evidence.report?.format === "journey-mesh/android-accessibility";
}
