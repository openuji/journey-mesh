import type {
  AxeAccessibilitySummaryEntry,
  AxeAccessibilitySummaryProfile,
  AxeAccessibilitySummaryReport,
  AxePathAuditItem,
  AxePathAuditReport
} from "../types.js";
import { pathAuditHtmlFileName } from "../artifacts/report-file-names.js";
import { emptyAxeSummary } from "./report-summary.js";
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
    return {
      schemaVersion: "ujg-fed-a11y.accessibility-summary-by-graph-id.v1",
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      source,
      states: profile.states,
      transitions: profile.transitions
    };
  }

  return {
    schemaVersion: "ujg-fed-a11y.accessibility-summary-by-graph-id.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source,
    profiles
  };
}

function groupAccessibilityEntriesByProfile(
  report: AxePathAuditReport,
  artifactBaseHref?: string
): Record<string, AxeAccessibilitySummaryProfile> {
  const profiles: Record<string, AxeAccessibilitySummaryProfile> = {};

  for (const item of report.items) {
    const target = accessibilityEntryTarget(item);
    if (!target) continue;

    const profileId = profileIdForItem(item);
    const profile = profiles[profileId] ?? emptyAccessibilitySummaryProfile();
    profiles[profileId] = profile;

    const entry = accessibilitySummaryEntry(item, target.id, report.reportId, artifactBaseHref);
    if (target.kind === "state") {
      addAccessibilitySummaryEntry(profile.states, entry);
    } else {
      addAccessibilitySummaryEntry(profile.transitions, entry);
    }
  }

  return profiles;
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
  const entry: AxeAccessibilitySummaryEntry = {
    id,
    itemId: item.itemId,
    auditId: item.auditId ?? null,
    status: item.status,
    summary: item.summary ?? emptyAxeSummary(),
    metrics: {
      pageState: item.scanSummaries?.["page-state"] ?? emptyAxeSummary(),
      matchedSurface: item.scanSummaries?.["matched-surface"] ?? emptyAxeSummary()
    },
    sourceHtmlHref: `${artifactHref(pathAuditHtmlFileName(reportId), artifactBaseHref)}#${item.itemId}`
  };

  if (item.sourceScreenshotHref) {
    entry.sourceScreenshotHref = artifactHref(item.sourceScreenshotHref, artifactBaseHref);
  }
  if (item.reason) {
    entry.reason = item.reason;
  }

  return entry;
}

function addAccessibilitySummaryEntry(
  entries: Record<string, AxeAccessibilitySummaryEntry>,
  entry: AxeAccessibilitySummaryEntry
): void {
  const existing = entries[entry.id];
  if (!existing) {
    entries[entry.id] = entry;
    return;
  }

  existing.additionalItems = [...(existing.additionalItems ?? []), entry];
}
