import type { PlaywrightOperationObservation } from "@openuji/journey-adapter-playwright";
import { errorToJourneyRunError } from "@openuji/journey-runner";

import type { AxeJourneyItem, AxeObserverOptions } from "../types.js";
import { immutableSnapshot } from "@openuji/journey-core";
import { safeFileSegment } from "../shared/strings.js";
import type { AxeScreenshotEvidence } from "./evidence.js";

export async function captureStateSourceScreenshot(
  options: AxeObserverOptions,
  observation: PlaywrightOperationObservation,
  journeyItem: AxeJourneyItem
): Promise<AxeScreenshotEvidence> {
  if (observation.stage !== "state-asserted" || !options.sourceScreenshots?.states) {
    return Object.freeze({ kind: "not-requested" });
  }

  try {
    const data = await observation.page.screenshot({
      fullPage: options.sourceScreenshots.fullPage ?? true,
      timeout: options.sourceScreenshots.timeoutMs
    });
    const artifact = await options.artifacts.write({
      name: `${safeFileSegment(journeyItem.auditId)}.source.playwright-screenshot.png`, data, contentType: "image/png",
      scope: { runId: observation.execution.runId, executionId: observation.execution.executionId, profileId: observation.execution.profile.id, operationId: observation.operation.id }
    });
    return Object.freeze({ kind: "captured", href: artifact.href });
  } catch (error) {
    return immutableSnapshot({ kind: "failed", error: errorToJourneyRunError(error) });
  }
}
