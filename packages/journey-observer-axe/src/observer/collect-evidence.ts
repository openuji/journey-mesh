import type { PlaywrightOperationObservation } from "@openuji/journey-adapter-playwright";
import { errorToJourneyRunError } from "@openuji/journey-runner";

import { createAxeJourneyItem } from "../journey/journey-item.js";
import { immutableSnapshot } from "../shared/immutable.js";
import type { AxeAuditRunner, AxeObserverOptions } from "../types.js";
import type { AxeAuditEvidence, AxeOperationEvidence } from "./evidence.js";
import { captureStateSourceScreenshot } from "./source-screenshot.js";

/** Collect runtime facts without classifying or storing report items. */
export async function collectAxeEvidence(
  observation: PlaywrightOperationObservation,
  options: AxeObserverOptions,
  auditRunner: AxeAuditRunner
): Promise<AxeOperationEvidence> {
  const identity = {
    runId: observation.execution.runId,
    executionId: observation.execution.executionId,
    profileId: observation.execution.profile.id
  };
  if (observation.stage === "control-flow-recorded") {
    return immutableSnapshot({ ...identity, stage: observation.stage, operation: observation.operation });
  }
  if (observation.stage === "transition-completed") {
    return immutableSnapshot({ ...identity, stage: observation.stage, operation: observation.operation });
  }

  const target = immutableSnapshot({
    ...identity,
    stage: observation.stage,
    operation: observation.operation,
    expectedMatchCount: observation.expectedMatchCount
  });
  const page = observation.page;
  const locator = observation.locator;
  const auditOptions = {
    testInfo: options.testInfo,
    artifacts: options.artifacts,
    strict: options.strict,
    tags: options.tags ? [...options.tags] : undefined,
    evidenceTimeoutMs: options.evidenceTimeoutMs
  };
  const journeyItem = createAxeJourneyItem(identity.profileId, identity.executionId, target.operation);
  const screenshot = await captureStateSourceScreenshot(options, observation, journeyItem);
  const audit = target.expectedMatchCount === 1
    ? await collectAudit(() => auditRunner({
      ...auditOptions,
      page,
      resolvedLocator: locator,
      auditId: journeyItem.auditId,
      metadata: journeyItem.metadata
    }))
    : { kind: "not-requested" as const };
  return immutableSnapshot({
    ...target,
    screenshot,
    audit
  });
}

async function collectAudit(scan: () => ReturnType<AxeAuditRunner>): Promise<AxeAuditEvidence> {
  try {
    return immutableSnapshot({ kind: "completed", report: await scan() });
  } catch (error) {
    return immutableSnapshot({ kind: "failed", error: errorToJourneyRunError(error) });
  }
}
