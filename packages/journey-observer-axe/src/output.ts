import type { JourneyObserverOutput } from "@openuji/journey-core";
import type { AxeEvidence } from "./observer/evidence.js";
import type { AxePathAuditReport } from "./types.js";

/** What the axe observer contributes to a test bundle. */
export type AxeObserverOutput = JourneyObserverOutput & {
  kind: "axe";
  evidence: Readonly<{ journal: readonly AxeEvidence[]; pathReport: AxePathAuditReport }>;
};

/** Saved bundles are plain JSON: check the shape before the reporter relies on it. */
export function isAxeOutput(output: JourneyObserverOutput): output is AxeObserverOutput {
  const evidence = output.evidence as { journal?: unknown; pathReport?: unknown } | null;
  return output.kind === "axe" && !!evidence && Array.isArray(evidence.journal) && !!evidence.pathReport && typeof evidence.pathReport === "object";
}
