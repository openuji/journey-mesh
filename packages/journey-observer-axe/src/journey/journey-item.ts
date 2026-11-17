import type {
  AxeAuditReport,
  AxeJourneyItem,
  AxeJourneyOperation,
  AxePathAuditItemInput,
  AxePathSourceScreenshotFields
} from "../types.js";
import { safeFileSegment } from "../shared/strings.js";
import { metadataForOperation } from "./operation-metadata.js";
import { immutableSnapshot } from "@openuji/journey-core";

export function createAxeJourneyItem(
  profileId: string,
  executionId: string,
  operation: AxeJourneyOperation
): AxeJourneyItem {
  const itemId = `${profileId}-${String(operation.sequence).padStart(3, "0")}-${safeFileSegment(operation.id.split(":").at(-1) ?? operation.id)}`;

  return immutableSnapshot({
    auditId: itemId,
    itemId,
    groupId: `${profileId}:${operation.entry.id}`,
    groupLabel: `${profileId} ${operation.entry.label ?? operation.entry.id}`,
    metadata: metadataForOperation(profileId, executionId, operation)
  });
}

export function auditedAxePathItem(
  journeyItem: AxeJourneyItem,
  report: AxeAuditReport,
  screenshots?: AxePathSourceScreenshotFields
): AxePathAuditItemInput {
  return {
    itemId: journeyItem.itemId,
    groupId: journeyItem.groupId,
    groupLabel: journeyItem.groupLabel,
    metadata: journeyItem.metadata,
    report,
    ...screenshots
  };
}

export function unauditedAxePathItem(
  journeyItem: AxeJourneyItem,
  status: "skipped" | "not-applicable",
  reason: string,
  screenshots?: AxePathSourceScreenshotFields
): AxePathAuditItemInput {
  return {
    itemId: journeyItem.itemId,
    groupId: journeyItem.groupId,
    groupLabel: journeyItem.groupLabel,
    metadata: journeyItem.metadata,
    status,
    reason,
    ...screenshots
  };
}
