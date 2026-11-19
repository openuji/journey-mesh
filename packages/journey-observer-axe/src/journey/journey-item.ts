import type {
  AxeJourneyItem,
  AxeJourneyOperation
} from "../types.js";
import { safeFileSegment } from "../shared/strings.js";
import { metadataForOperation } from "./operation-metadata.js";
import { immutableSnapshot } from "@openuji/journey-core";

/** The stable identity of one audited operation: audit and item IDs, grouping, and plan metadata. */
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
