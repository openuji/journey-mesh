import type { JourneyObserverOutput } from "@openuji/journey-core";
import type { AxeEvidence, AxeOperationEvidence, AxeAuditEvidence } from "./observer/evidence.js";
import type { AxePathAuditReport } from "./types.js";
import type { JsonDocumentRef } from "@openuji/journey-plugin";

/** The raw journal stays local to the observer; saved outputs contain audit references. */
type LinkedOperation<T> = T extends { audit: AxeAuditEvidence }
  ? Omit<T, "audit"> & { audit: Exclude<AxeAuditEvidence, { kind: "completed" }> | { kind: "completed"; document: JsonDocumentRef } } : T;
export type LinkedAxeFact = Extract<AxeEvidence, { kind: "execution-started" }>
  | Readonly<{ kind: "operation-observed"; evidence: LinkedOperation<AxeOperationEvidence> }>;

export function linkedAxeJournal(journal: readonly AxeEvidence[]): readonly LinkedAxeFact[] {
  return journal.map((fact) => {
    if (fact.kind === "execution-started") return fact;
    const evidence = fact.evidence;
    if (!("audit" in evidence)) return { kind: "operation-observed" as const, evidence };
    const { audit, ...base } = evidence;
    if (audit.kind !== "completed") return { kind: "operation-observed" as const, evidence: { ...base, audit } };
    if (!audit.document) throw new Error(`Missing persisted axe audit ${audit.report.auditId}`);
    return { kind: "operation-observed" as const, evidence: { ...base, audit: { kind: "completed" as const, document: audit.document } } };
  });
}

/** What the axe observer contributes to a test bundle. */
export type AxeObserverOutput = JourneyObserverOutput & {
  kind: "axe";
  evidence: Readonly<{ journal: readonly LinkedAxeFact[]; pathReport: AxePathAuditReport }>;
};

/** Saved bundles are plain JSON: check the shape before the reporter relies on it. */
export function isAxeOutput(output: JourneyObserverOutput): output is AxeObserverOutput {
  const evidence = output.evidence as { journal?: unknown; pathReport?: unknown } | null;
  return output.kind === "axe" && !!evidence && Array.isArray(evidence.journal) && !!evidence.pathReport && typeof evidence.pathReport === "object";
}
