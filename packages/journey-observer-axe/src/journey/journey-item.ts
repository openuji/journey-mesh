import type {
  AxeAuditReport,
  AxeJourneyItem,
  AxeJourneyOperation,
  AxePathAuditItemInput,
  AxePathSourceScreenshotFields
} from "../types.js";
import { safeFileSegment } from "../shared/strings.js";
import { metadataForOperation } from "./operation-metadata.js";

export function createAxeJourneyItem(
  profileId: string,
  executionId: string,
  operation: AxeJourneyOperation
): AxeJourneyItem {
  const graphNodeId = graphNodeIdForOperation(operation);
  const itemId = `${profileId}-${String(operation.sequence).padStart(3, "0")}-${graphNodeSlug(graphNodeId)}`;

  return {
    auditId: itemId,
    itemId,
    groupId: `${profileId}:${operation.entry.id}`,
    groupLabel: `${profileId} ${operation.entry.label ?? operation.entry.id}`,
    metadata: metadataForOperation(profileId, executionId, graphNodeId, operation)
  };
}

export function initialAxePathItem(
  journeyItem: AxeJourneyItem,
  operation: AxeJourneyOperation
): AxePathAuditItemInput {
  if (operation.kind === "control-flow") {
    return unauditedAxePathItem(
      journeyItem,
      "not-applicable",
      "Control-flow items do not resolve to a page surface."
    );
  }

  if (operation.kind === "state" && operation.target.expectedMatchCount !== 1) {
    return unauditedAxePathItem(
      journeyItem,
      "skipped",
      `Expected match count ${operation.target.expectedMatchCount} cannot be scoped to one matched locator.`
    );
  }

  return unauditedAxePathItem(
    journeyItem,
    "skipped",
    "Plan item was not audited because the runner ended before this item could be scanned."
  );
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

export function itemKey(executionId: string, operationId: string): string {
  return `${executionId}\u0000${operationId}`;
}

function graphNodeIdForOperation(operation: AxeJourneyOperation): string {
  if (operation.kind === "state") return operation.state.id;
  return operation.transition.id;
}

function graphNodeSlug(graphNodeId: string): string {
  return safeFileSegment(graphNodeId.split(":").at(-1) ?? graphNodeId);
}
