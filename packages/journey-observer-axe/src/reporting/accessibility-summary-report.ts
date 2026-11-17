import type {
  AxeAccessibilitySummaryEntry,
  AxeAccessibilitySummaryProfile,
  AxeAccessibilitySummaryReport,
  AxePathAuditItem,
  AxePathAuditReport
} from "../types.js";
import { pathAuditHtmlFileName } from "../artifacts/report-file-names.js";
import { emptyAxeSummary } from "./report-summary.js";
import { immutableSnapshot } from "@openuji/journey-core";
import { profileIdForItem, stringMetadataValue } from "../shared/strings.js";

export function buildAxeAccessibilitySummaryReport(input: {
  pathReport: AxePathAuditReport;
  generatedAt?: string;
}): AxeAccessibilitySummaryReport {
  const profiles = groupAccessibilityEntriesByProfile(input.pathReport);
  const profileIds = Object.keys(profiles);
  const reportMode = profileIds.length > 1 ? "multi-profile" : profileIds[0] ?? "unprofiled";
  const source = {
    reportId: input.pathReport.reportId,
    reportMode,
    reportCreatedAt: input.pathReport.createdAt,
    aggregateHtmlHref: pathAuditHtmlFileName(input.pathReport.reportId),
    summary: input.pathReport.summary
  };

  if (profileIds.length <= 1) {
    const profile = profiles[profileIds[0] ?? ""] ?? emptyAccessibilitySummaryProfile();
    return immutableSnapshot({
      format: "journey-mesh/accessibility-summary",
      generatedAt: input.generatedAt ?? input.pathReport.createdAt,
      source,
      states: profile.states,
      transitions: profile.transitions
    });
  }

  return immutableSnapshot({
    format: "journey-mesh/accessibility-summary",
    generatedAt: input.generatedAt ?? input.pathReport.createdAt,
    source,
    profiles
  });
}

function groupAccessibilityEntriesByProfile(report: AxePathAuditReport): Record<string, AxeAccessibilitySummaryProfile> {
  return report.items.reduce<Record<string, AxeAccessibilitySummaryProfile>>((profiles, item) => {
    const target = accessibilityEntryTarget(item);
    if (!target) return profiles;

    const profileId = profileIdForItem(item);
    const profile = profiles[profileId] ?? emptyAccessibilitySummaryProfile();
    const entry = accessibilitySummaryEntry(item, target.id, report.reportId);
    return {
      ...profiles,
      [profileId]: target.kind === "state"
        ? { ...profile, states: addAccessibilitySummaryEntry(profile.states, entry) }
        : { ...profile, transitions: addAccessibilitySummaryEntry(profile.transitions, entry) }
    };
  }, {});
}

function emptyAccessibilitySummaryProfile(): AxeAccessibilitySummaryProfile {
  return {
    states: {},
    transitions: {}
  };
}

function accessibilityEntryTarget(
  item: AxePathAuditItem
): { kind: "state" | "transition"; id: string } | undefined {
  const stateId = stringMetadataValue(item.metadata, "stateId");
  if (stateId) return { kind: "state", id: stringMetadataValue(item.metadata, "operationId")! };

  const transitionId = stringMetadataValue(item.metadata, "transitionId");
  if (!transitionId || stringMetadataValue(item.metadata, "kind") === "control-flow") {
    return undefined;
  }
  return { kind: "transition", id: stringMetadataValue(item.metadata, "operationId")! };
}

function accessibilitySummaryEntry(
  item: AxePathAuditItem,
  id: string,
  reportId: string
): AxeAccessibilitySummaryEntry {
  return {
    id,
    itemId: item.itemId,
    auditId: item.auditId ?? null,
    status: item.status,
    summary: item.summary ?? emptyAxeSummary(),
    metrics: {
      pageState: item.scanSummaries?.["page-state"] ?? emptyAxeSummary(),
      matchedSurface: item.scanSummaries?.["matched-surface"] ?? emptyAxeSummary()
    },
    sourceHtmlHref: `${pathAuditHtmlFileName(reportId)}#${item.itemId}`,
    ...(item.sourceScreenshotHref ? { sourceScreenshotHref: item.sourceScreenshotHref } : {}),
    ...(item.reason ? { reason: item.reason } : {})
  };
}

function addAccessibilitySummaryEntry(
  entries: Record<string, AxeAccessibilitySummaryEntry>,
  entry: AxeAccessibilitySummaryEntry
): Record<string, AxeAccessibilitySummaryEntry> {
  const existing = entries[entry.id];
  return {
    ...entries,
    [entry.id]: existing ? { ...existing, additionalItems: [...(existing.additionalItems ?? []), entry] } : entry
  };
}
