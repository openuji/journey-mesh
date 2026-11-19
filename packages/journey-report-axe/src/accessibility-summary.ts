import { immutableSnapshot } from "@openuji/journey-core";
import { emptyAxeSummary, stringMetadataValue } from "@openuji/journey-observer-axe/evidence";
import {
  accessibilitySummaryFormat,
  type AxeAccessibilitySummaryEntry, type AxeAccessibilitySummaryProfile, type AxeAccessibilitySummaryReport, type AxePathAuditItem, type AxePathAuditReport
} from "./types.js";

export function profileIdForItem(item: AxePathAuditItem): string {
  return stringMetadataValue(item.metadata, "profileId") ?? item.groupId?.split(":")[0] ?? "unprofiled";
}

/** Counts per state and transition; `aggregateJsonHref` names the path report document next to it. */
export function buildAxeAccessibilitySummaryReport(input: { pathReport: AxePathAuditReport; aggregateJsonHref: string; generatedAt?: string }): AxeAccessibilitySummaryReport {
  const profiles = groupByProfile(input.pathReport);
  const profileIds = Object.keys(profiles);
  const reportMode = profileIds.length > 1 ? "multi-profile" : profileIds[0] ?? "unprofiled";
  const source = {
    reportId: input.pathReport.reportId, reportMode, reportCreatedAt: input.pathReport.createdAt,
    aggregateJsonHref: input.aggregateJsonHref, summary: input.pathReport.summary
  };
  const generatedAt = input.generatedAt ?? input.pathReport.createdAt;
  if (profileIds.length <= 1) {
    const profile = profiles[profileIds[0] ?? ""] ?? emptyProfile();
    return immutableSnapshot({ format: accessibilitySummaryFormat, generatedAt, source, states: profile.states, transitions: profile.transitions });
  }
  return immutableSnapshot({ format: accessibilitySummaryFormat, generatedAt, source, profiles });
}

function groupByProfile(report: AxePathAuditReport): Record<string, AxeAccessibilitySummaryProfile> {
  return report.items.reduce<Record<string, AxeAccessibilitySummaryProfile>>((profiles, item) => {
    const target = entryTarget(item);
    if (!target) return profiles;
    const profileId = profileIdForItem(item);
    const profile = profiles[profileId] ?? emptyProfile();
    const entry = summaryEntry(item, target.id);
    return {
      ...profiles,
      [profileId]: target.kind === "state"
        ? { ...profile, states: addEntry(profile.states, entry) }
        : { ...profile, transitions: addEntry(profile.transitions, entry) }
    };
  }, {});
}

const emptyProfile = (): AxeAccessibilitySummaryProfile => ({ states: {}, transitions: {} });

function entryTarget(item: AxePathAuditItem): { kind: "state" | "transition"; id: string } | undefined {
  const stateId = stringMetadataValue(item.metadata, "stateId");
  if (stateId) return { kind: "state", id: stringMetadataValue(item.metadata, "operationId")! };
  const transitionId = stringMetadataValue(item.metadata, "transitionId");
  if (!transitionId || stringMetadataValue(item.metadata, "kind") === "control-flow") return undefined;
  return { kind: "transition", id: stringMetadataValue(item.metadata, "operationId")! };
}

function summaryEntry(item: AxePathAuditItem, id: string): AxeAccessibilitySummaryEntry {
  return {
    id, itemId: item.itemId, auditId: item.auditId ?? null, status: item.status,
    summary: item.summary ?? emptyAxeSummary(),
    metrics: {
      pageState: item.scanSummaries?.["page-state"] ?? emptyAxeSummary(),
      matchedSurface: item.scanSummaries?.["matched-surface"] ?? emptyAxeSummary()
    },
    ...(item.sourceScreenshotHref ? { sourceScreenshotHref: item.sourceScreenshotHref } : {}),
    ...(item.reason ? { reason: item.reason } : {})
  };
}

function addEntry(entries: Record<string, AxeAccessibilitySummaryEntry>, entry: AxeAccessibilitySummaryEntry): Record<string, AxeAccessibilitySummaryEntry> {
  const existing = entries[entry.id];
  return { ...entries, [entry.id]: existing ? { ...existing, additionalItems: [...(existing.additionalItems ?? []), entry] } : entry };
}
