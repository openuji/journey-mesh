import type { PlaywrightOperationObservation } from "@openuji/journey-adapter-playwright";

import type {
  AxeJourneyItem,
  AxeObserverOptions,
  AxePathSourceScreenshotFields
} from "../types.js";
import { errorMessage, safeFileSegment } from "../shared/strings.js";

export async function captureStateSourceScreenshot(
  options: AxeObserverOptions,
  observation: PlaywrightOperationObservation,
  journeyItem: AxeJourneyItem
): Promise<AxePathSourceScreenshotFields | undefined> {
  if (observation.stage !== "state-asserted" || !options.sourceScreenshots?.states) {
    return undefined;
  }

  const href = `${safeFileSegment(journeyItem.auditId)}.source.playwright-screenshot.png`;
  const path = options.testInfo.outputPath(href);

  try {
    await observation.page.screenshot({
      path,
      fullPage: options.sourceScreenshots.fullPage ?? true,
      timeout: options.sourceScreenshots.timeoutMs
    });
    await options.testInfo.attach(
      `playwright-${safeFileSegment(journeyItem.auditId)}-source.png`,
      { path, contentType: "image/png" }
    );
    return { sourceScreenshotHref: href };
  } catch (error) {
    return { sourceScreenshotError: errorMessage(error) };
  }
}
