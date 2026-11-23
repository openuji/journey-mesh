/**
 * What the operability observer records, for consumers of run records (reports, dashboards, comparisons).
 * Types and a pure guard only: this entry loads no browser runtime.
 */
import type { JourneyInputAction, JourneyObserverOutput } from "@openuji/journey-core";

export const operabilityObserverKind = "operability";
export const operabilityEvidenceFormat = "journey-mesh/operability-evidence";

/**
 * The input decision for one transition of one execution: the modality the profile selected,
 * the InputModalityProfile it satisfies, and the declared TransitionMaterialization it ran.
 * The materialization's steps are resolved in the test record's plan.
 */
export type OperabilityDecisionRecord = Readonly<{
  runId: string;
  executionId: string;
  profileId: string;
  operationId: string;
  inputModalityProfileId: string;
  modalityId: string;
  modalityLabel?: string;
  /** Absent for producer text entry without focus moves, or for adapters with direct commands. */
  materializationId?: string;
}>;

export type OperabilityEvidence = Readonly<{
  format: typeof operabilityEvidenceFormat;
  version: 1;
  decisions: readonly OperabilityDecisionRecord[];
  /** One entry per adapter command, with its final status, in the order the commands were attempted. */
  actions: readonly JourneyInputAction[];
}>;

export type OperabilityObserverOutput = JourneyObserverOutput & Readonly<{
  kind: typeof operabilityObserverKind;
  evidence: OperabilityEvidence;
}>;

export function isOperabilityOutput(output: JourneyObserverOutput): output is OperabilityObserverOutput {
  const evidence = output.evidence as Partial<OperabilityEvidence> | undefined;
  return output.kind === operabilityObserverKind
    && evidence?.format === operabilityEvidenceFormat
    && evidence.version === 1
    && Array.isArray(evidence.decisions)
    && Array.isArray(evidence.actions);
}
