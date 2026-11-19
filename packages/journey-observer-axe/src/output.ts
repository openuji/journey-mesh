import type { JourneyObserverOutput, Immutable } from "@openuji/journey-core";
import type { AxeEvidence, AxeOperationEvidence, AxeAuditEvidence, AxeEvidenceRef } from "./observer/evidence.js";
import type { AxeAuditMetadata } from "./types.js";
import { axeObserverKind } from "./constants.js";

/** The raw journal stays local to the observer; recorded outputs reference the audit evidence files. */
type LinkedOperation<T> = T extends { audit: AxeAuditEvidence }
  ? Omit<T, "audit"> & { audit: Exclude<AxeAuditEvidence, { kind: "completed" }> | { kind: "completed"; document: AxeEvidenceRef } } : T;
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

/** What the axe observer records for a test: capture settings and the linked journal. */
export type AxeRecordedEvidence = Readonly<{
  reportId: string;
  createdAt: string;
  wcagTags: readonly string[];
  metadata?: Immutable<AxeAuditMetadata>;
  journal: readonly LinkedAxeFact[];
}>;

export type AxeObserverOutput = JourneyObserverOutput & { kind: typeof axeObserverKind; evidence: AxeRecordedEvidence };

/** Recorded outputs are plain JSON: check the shape before relying on it. */
export function isAxeOutput(output: JourneyObserverOutput): output is AxeObserverOutput {
  const evidence = output.evidence as Partial<AxeRecordedEvidence> | null;
  return output.kind === axeObserverKind && !!evidence && Array.isArray(evidence.journal) && typeof evidence.reportId === "string";
}
