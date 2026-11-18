import { immutableSnapshot } from "@openuji/journey-core";
import { errorToJourneyRunError, type JourneyRunError } from "@openuji/journey-runner";
import type { JourneyReporter, JourneyResultBundle, JourneyArtifactStore } from "@openuji/journey-plugin";
export { compareMeasurements, inferPairings, validatePairings } from "./comparison.js";
export type { MeasurementDifference } from "./comparison.js";
export { compareBundles } from "./compare-bundles.js";
export type { CompareBundlesInput } from "./compare-bundles.js";
export { publishReport, viewerHtml, writeReport, readSavedBundle } from "./publish.js";
export type { PublishedBundle } from "./publish.js";
export { fileArtifactStore } from "./artifact-store.js";
export { testFailures, testPassed } from "./outcome.js";
export { selectJourneyMaps } from "./journey-maps.js";
export { testDirectory, subjectDirectory, artifactHref } from "./paths.js";

/** Reporters receive detached snapshots; a failure never changes execution history. */
export async function reportJourneyResult(input: {
  bundle: JourneyResultBundle; reporters: readonly JourneyReporter[]; artifacts: JourneyArtifactStore;
}): Promise<readonly JourneyRunError[]> {
  const errors: JourneyRunError[] = [];
  for (const reporter of input.reporters) {
    try { await reporter.report({ bundle: immutableSnapshot(input.bundle), artifacts: input.artifacts }); }
    catch (error) { errors.push(errorToJourneyRunError(error)); }
  }
  return Object.freeze(errors);
}
