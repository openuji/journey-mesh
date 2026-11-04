import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { axeArtifacts } from "../artifacts/artifact-target.js";
import type { PlaywrightOperationObservation } from "@openuji/journey-adapter-playwright";
import { errorToJourneyRunError } from "@openuji/journey-runner";

import type { AxeJourneyItem, AxeObserverOptions } from "../types.js";
import { immutableSnapshot } from "../shared/immutable.js";
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

  const href = `${safeFileSegment(journeyItem.auditId)}.source.playwright-screenshot.png`;
  const artifacts = axeArtifacts(options);
  const path = artifacts.outputPath(href);
  try {
    await mkdir(dirname(path), { recursive: true });
    await observation.page.screenshot({
      path,
      fullPage: options.sourceScreenshots.fullPage ?? true,
      timeout: options.sourceScreenshots.timeoutMs
    });
    await artifacts.attach(`playwright-${safeFileSegment(journeyItem.auditId)}-source.png`, {
      path, contentType: "image/png"
    });
    return Object.freeze({ kind: "captured", href });
  } catch (error) {
    return immutableSnapshot({ kind: "failed", error: errorToJourneyRunError(error) });
  }
}
