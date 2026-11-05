import type { AppiumExecutionObserver, AppiumOperationObservation } from "@openuji/journey-adapter-appium";
import { errorToJourneyRunError, type JourneyReporter } from "@openuji/journey-runner";
import type { AndroidAccessibilityEvidence, AndroidArtifactReader, AndroidArtifactWriter, AndroidCapture, AndroidOperationEvidence } from "./evidence.js";
import { checkAndroidHierarchy, parseAndroidHierarchy, redactAndroidHierarchy } from "./hierarchy.js";
import { immutableSnapshot } from "./immutable.js";
import { androidAccessibilityFindings, buildAndroidAccessibilityReport, renderAndroidAccessibilityReport, type AndroidAccessibilityReport } from "./report.js";
import { loadAndroidReportResources } from "./report-resources.js";

export type * from "./evidence.js";
export type * from "./hierarchy.js";
export { checkAndroidHierarchy, parseAndroidHierarchy, redactAndroidHierarchy } from "./hierarchy.js";
export { androidAccessibilityFindings, buildAndroidAccessibilityReport, renderAndroidAccessibilityReport } from "./report.js";
export type { AndroidAccessibilityReport, AndroidAccessibilityPathItem, AndroidReportResource } from "./report.js";
export { loadAndroidReportResources } from "./report-resources.js";

export type AndroidAccessibilityObserverOptions = Readonly<{
  reportId: string;
  writeArtifact: AndroidArtifactWriter;
  /** Defaults to reading artifact.path from disk; custom stores supply their reader. */
  readArtifact?: AndroidArtifactReader;
  screenshots?: boolean;
  strict?: boolean;
  excludedPhaseIds?: readonly string[];
  now?: () => string;
}>;
export type AndroidAccessibilityObserver = AppiumExecutionObserver & JourneyReporter & {
  readonly evidence: readonly AndroidAccessibilityEvidence[];
  readonly latestReport: AndroidAccessibilityReport | undefined;
  readonly latestReportPath: string | undefined;
  readonly latestJsonPath: string | undefined;
  readonly latestEvidencePath: string | undefined;
};

export function androidAccessibilityObserver(options: AndroidAccessibilityObserverOptions): AndroidAccessibilityObserver {
  const configuredOptions = Object.freeze({
    ...options,
    excludedPhaseIds: Object.freeze([...(options.excludedPhaseIds ?? [])])
  });
  // The append boundary owns mutable storage. Every fact and published view is immutable.
  let facts: readonly AndroidAccessibilityEvidence[] = Object.freeze([]);
  let published: Readonly<{ report: AndroidAccessibilityReport; htmlPath: string; jsonPath: string; evidencePath: string }> | undefined;
  const append = (fact: AndroidAccessibilityEvidence) => { facts = Object.freeze([...facts, immutableSnapshot(fact)]); };
  return {
    name: "@openuji/journey-observer-android-accessibility", version: "0.1.0",
    get evidence() { return facts; },
    get latestReport() { return published?.report; },
    get latestReportPath() { return published?.htmlPath; },
    get latestJsonPath() { return published?.jsonPath; },
    get latestEvidencePath() { return published?.evidencePath; },
    onExecutionStarted({ execution }) { append(immutableSnapshot({ kind: "execution-started", execution })); },
    async observeOperation(observation) {
      const collected = await collectAndroidEvidence(observation, configuredOptions, facts.length);
      append({ kind: "operation-observed", evidence: collected });
      const failures = [collected.hierarchy, collected.metrics, collected.screenshot].flatMap((capture) => capture?.kind === "failed" ? [capture.error] : []);
      if (failures.length) throw new Error(`Android evidence collection failed: ${failures.map((error) => error.message).join("; ")}`);
    },
    async report({ result }) {
      const evidence = facts.filter((fact) => fact.kind === "execution-started" ? fact.execution.runId === result.runId : fact.evidence.runId === result.runId);
      const report = buildAndroidAccessibilityReport({ reportId: configuredOptions.reportId, createdAt: (configuredOptions.now ?? (() => new Date().toISOString()))(), result, evidence, strict: configuredOptions.strict ?? false });
      const resources = await loadAndroidReportResources(report, configuredOptions.readArtifact);
      // Content-addressed bundles keep previously published files intact if a later write fails.
      const name = `${safeName(configuredOptions.reportId)}-${identityHash(JSON.stringify([report, evidence, resources]))}`;
      const journal = await configuredOptions.writeArtifact({ name: `${name}.evidence.json`, data: JSON.stringify(evidence, null, 2), contentType: "application/json" });
      const json = await configuredOptions.writeArtifact({ name: `${name}.json`, data: JSON.stringify(report, null, 2), contentType: "application/json" });
      const html = await configuredOptions.writeArtifact({ name: `${name}.html`, data: renderAndroidAccessibilityReport(report, resources), contentType: "text/html" });
      published = Object.freeze({ report, htmlPath: html.path, jsonPath: json.path, evidencePath: journal.path });
      const findings = androidAccessibilityFindings(evidence, result.runId);
      if (configuredOptions.strict && findings.length) throw new Error(`Android hierarchy checks recorded ${findings.length} potential finding(s) across observed surfaces. See the native evidence reports.`);
    }
  };
}

async function collectAndroidEvidence(observation: AppiumOperationObservation, options: AndroidAccessibilityObserverOptions, index: number): Promise<AndroidOperationEvidence> {
  // Snapshot before reading a device, clock, or artifact writer.
  const target = immutableSnapshot({ runId: observation.execution.runId, executionId: observation.execution.executionId, profileId: observation.execution.profile.id, operation: observation.operation, stage: observation.stage });
  const phaseId = operationPhaseId(observation.operation);
  if (phaseId && options.excludedPhaseIds?.includes(phaseId)) {
    return immutableSnapshot({
      ...target,
      notApplicable: { phaseId, reason: `Phase ${phaseId} is excluded from accessibility capture.` },
      checks: []
    });
  }
  if (observation.stage === "transition-completed" || observation.stage === "control-flow-recorded") return immutableSnapshot({ ...target, checks: [] });
  const targets = Object.freeze(observation.targets.map((element) => element.elementId));
  const expectedMatchCount = observation.expectedMatchCount;
  const prefix = `android-${identityHash(JSON.stringify([target.runId, target.executionId, target.operation.id]))}-${index}`;
  const hierarchy = await capture(async () => {
    const xml = redactAndroidHierarchy(await observation.session.source());
    const nodes = parseAndroidHierarchy(xml);
    const artifact = await options.writeArtifact({ name: `${prefix}.hierarchy.xml`, data: xml, contentType: "application/xml" });
    return { nodes, artifact };
  });
  const metrics = await capture(() => observation.session.deviceMetrics());
  const screenshot = options.screenshots ? await capture(async () => {
    const data = Buffer.from(await observation.session.screenshot(), "base64");
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Native screenshot is not a PNG image");
    return options.writeArtifact({ name: `${prefix}.png`, data, contentType: "image/png" });
  }) : { kind: "not-requested" as const };
  const checks = hierarchy.kind === "captured" ? checkAndroidHierarchy(hierarchy.value.nodes, metrics.kind === "captured" ? metrics.value : {}) : [];
  return immutableSnapshot({ ...target, expectedMatchCount, targets, hierarchy, metrics, screenshot, checks });
}

function operationPhaseId(operation: AppiumOperationObservation["operation"]): string | undefined {
  const value = operation.source?.references?.phaseId;
  return typeof value === "string" ? value : undefined;
}

async function capture<T>(read: () => Promise<T>): Promise<AndroidCapture<T>> {
  try { return { kind: "captured", value: await read() }; }
  catch (error) { return { kind: "failed", error: errorToJourneyRunError(error) }; }
}
function safeName(value: string): string { return value.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 100) || "android-accessibility"; }
function identityHash(value: string): string {
  return [...value].reduce((hash, char) => BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 1099511628211n), 14695981039346656037n).toString(16);
}
