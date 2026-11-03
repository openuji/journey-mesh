import type {
  AxeAccessibilitySummaryEntry,
  AxeAccessibilitySummaryProfile,
  AxeAccessibilitySummaryReport,
  AxePathAuditItem,
  AxePathAuditReport
} from "../types.js";
import { pathAuditHtmlFileName } from "../artifacts/report-file-names.js";
import { emptyAxeSummary } from "./report-summary.js";
import { immutableSnapshot } from "../shared/immutable.js";
import {
  artifactHref,
  profileIdForItem,
  stringMetadataValue
} from "../shared/strings.js";

export function buildAxeAccessibilitySummaryReport(input: {
  pathReport: AxePathAuditReport;
  generatedAt?: string;
  delivery?: string;
  artifactBaseHref?: string;
  testResultDirectoryName?: string;
}): AxeAccessibilitySummaryReport {
  const profiles = groupAccessibilityEntriesByProfile(input.pathReport, input.artifactBaseHref);
  const profileIds = Object.keys(profiles);
  const reportMode = profileIds.length > 1 ? "multi-profile" : profileIds[0] ?? "unprofiled";
  const source = {
    ...(input.testResultDirectoryName
      ? { testResultDirectoryName: input.testResultDirectoryName }
      : {}),
    reportId: input.pathReport.reportId,
    reportMode,
    reportCreatedAt: input.pathReport.createdAt,
    ...(input.delivery ? { delivery: input.delivery } : {}),
    aggregateHtmlHref: artifactHref(
      pathAuditHtmlFileName(input.pathReport.reportId),
      input.artifactBaseHref
    ),
    summary: input.pathReport.summary
  };

  if (profileIds.length <= 1) {
    const profile = profiles[profileIds[0] ?? ""] ?? emptyAccessibilitySummaryProfile();
    return immutableSnapshot({
      schemaVersion: "ujg-fed-a11y.accessibility-summary-by-graph-id.v1",
      generatedAt: input.generatedAt ?? input.pathReport.createdAt,
      source,
      states: profile.states,
      transitions: profile.transitions
    });
  }

  return immutableSnapshot({
    schemaVersion: "ujg-fed-a11y.accessibility-summary-by-graph-id.v1",
    generatedAt: input.generatedAt ?? input.pathReport.createdAt,
    source,
    profiles
  });
}

function groupAccessibilityEntriesByProfile(
  report: AxePathAuditReport,
  artifactBaseHref?: string
): Record<string, AxeAccessibilitySummaryProfile> {
  return report.items.reduce<Record<string, AxeAccessibilitySummaryProfile>>((profiles, item) => {
    const target = accessibilityEntryTarget(item);
    if (!target) return profiles;

    const profileId = profileIdForItem(item);
    const profile = profiles[profileId] ?? emptyAccessibilitySummaryProfile();
    const entry = accessibilitySummaryEntry(item, target.id, report.reportId, artifactBaseHref);
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
  if (stateId) return { kind: "state", id: stateId };

  const transitionId = stringMetadataValue(item.metadata, "transitionId");
  if (!transitionId || stringMetadataValue(item.metadata, "kind") === "control-flow") {
    return undefined;
  }
  return { kind: "transition", id: transitionId };
}

function accessibilitySummaryEntry(
  item: AxePathAuditItem,
  id: string,
  reportId: string,
  artifactBaseHref?: string
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
    sourceHtmlHref: `${artifactHref(pathAuditHtmlFileName(reportId), artifactBaseHref)}#${item.itemId}`,
    ...(item.sourceScreenshotHref ? { sourceScreenshotHref: artifactHref(item.sourceScreenshotHref, artifactBaseHref) } : {}),
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
