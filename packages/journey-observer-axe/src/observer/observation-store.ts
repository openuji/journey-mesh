import type { PlaywrightOperationObservation } from "@openuji/journey-adapter-playwright";
import type { JourneyExecutionDescriptor } from "@openuji/journey-runner";

import type {
  AxeJourneyItem,
  AxePathAuditItemInput
} from "../types.js";
import {
  createAxeJourneyItem,
  initialAxePathItem,
  itemKey
} from "../journey/journey-item.js";

export class AxeObservationStore {
  private readonly itemInputs = new Map<string, AxePathAuditItemInput>();
  private readonly itemOrder: string[] = [];

  setItem(key: string, item: AxePathAuditItemInput): void {
    if (!this.itemInputs.has(key)) {
      this.itemOrder.push(key);
    }
    this.itemInputs.set(key, item);
  }

  seedExecution(execution: JourneyExecutionDescriptor): void {
    for (const operation of execution.plan.operations) {
      const journeyItem = createAxeJourneyItem(
        execution.profile.id,
        execution.executionId,
        operation
      );
      this.setItem(
        itemKey(execution.executionId, operation.id),
        initialAxePathItem(journeyItem, operation)
      );
    }
  }

  requireJourneyItem(observation: PlaywrightOperationObservation): AxeJourneyItem {
    const journeyItem = createAxeJourneyItem(
      observation.execution.profile.id,
      observation.execution.executionId,
      observation.operation
    );
    const key = itemKey(observation.execution.executionId, observation.operation.id);
    if (!this.itemInputs.has(key)) {
      this.setItem(key, initialAxePathItem(journeyItem, observation.operation));
    }
    return journeyItem;
  }

  orderedItems(): AxePathAuditItemInput[] {
    return this.itemOrder.map((key) => {
      const item = this.itemInputs.get(key);
      if (!item) throw new Error(`Missing axe path item ${key}`);
      return item;
    });
  }
}
