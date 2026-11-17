import { immutableSnapshot, type JourneyObserverOutput, type JourneyMeasurement } from "@openuji/journey-core";
import type { AppiumExecutionObserver, AppiumOperationObservation } from "@openuji/journey-adapter-appium";
import { errorToJourneyRunError, type RunResult } from "@openuji/journey-runner";
import type { AndroidAccessibilityEvidence, AndroidArtifactWriter, AndroidCapture, AndroidOperationEvidence } from "./evidence.js";
import { checkAndroidHierarchy, parseAndroidHierarchy, redactAndroidHierarchy } from "./hierarchy.js";
import { androidAccessibilityFindings, buildAndroidAccessibilityReport } from "./report.js";

export type * from "./evidence.js";
export type * from "./hierarchy.js";
export { checkAndroidHierarchy, parseAndroidHierarchy, redactAndroidHierarchy } from "./hierarchy.js";
export { androidAccessibilityFindings, buildAndroidAccessibilityReport, renderAndroidAccessibilityReport } from "./report.js";
export type { AndroidAccessibilityReport, AndroidAccessibilityPathItem, AndroidReportResource } from "./report.js";
export { loadAndroidReportResources } from "./report-resources.js";
export { isAndroidAccessibilityOutput } from "./output.js";
export type { AndroidAccessibilityObserverOutput } from "./output.js";

export type AndroidAccessibilityObserverOptions = Readonly<{
  reportId: string;
  writeArtifact: AndroidArtifactWriter;
  screenshots?: boolean;
  strict?: boolean;
  excludedPhaseIds?: readonly string[];
  now?: () => string;
}>;
export type AndroidAccessibilityObserver = AppiumExecutionObserver & {
  readonly evidence: readonly AndroidAccessibilityEvidence[];
  output(result: RunResult): JourneyObserverOutput;
};

export function androidAccessibilityObserver(options: AndroidAccessibilityObserverOptions): AndroidAccessibilityObserver {
  const configuredOptions = Object.freeze({
    ...options,
    excludedPhaseIds: Object.freeze([...(options.excludedPhaseIds ?? [])])
  });
  // The append boundary owns mutable storage. Every fact and published view is immutable.
  let facts: readonly AndroidAccessibilityEvidence[] = Object.freeze([]);
  const append = (fact: AndroidAccessibilityEvidence) => { facts = Object.freeze([...facts, immutableSnapshot(fact)]); };
  return {
    name: "@openuji/journey-observer-android-accessibility", version: "0.1.0",
    get evidence() { return facts; },
    onExecutionStarted({ execution }) { append(immutableSnapshot({ kind: "execution-started", execution })); },
    async observeOperation(observation) {
      const collected = await collectAndroidEvidence(observation, configuredOptions, facts.length);
      append({ kind: "operation-observed", evidence: collected });
      const failures = [collected.hierarchy, collected.metrics, collected.screenshot].flatMap((capture) => capture?.kind === "failed" ? [capture.error] : []);
      if (failures.length) throw new Error(`Android evidence collection failed: ${failures.map((error) => error.message).join("; ")}`);
    },
    output(result) {
      const evidence = facts.filter((fact) => fact.kind === "execution-started" ? fact.execution.runId === result.runId : fact.evidence.runId === result.runId);
      const report = buildAndroidAccessibilityReport({ reportId: configuredOptions.reportId, createdAt: (configuredOptions.now ?? (() => new Date().toISOString()))(), result, evidence, strict: configuredOptions.strict ?? false });
      const measurements: JourneyMeasurement[] = result.evidence.executions.map((execution) => {
        const items = report.items.filter((item) => item.executionId === execution.executionId);
        const checked = items.filter((item) => item.status === "checked");
        const complete = result.executions.find((item) => item.executionId === execution.executionId)?.outcome.kind === "passed" && !items.some((item) => item.status === "error" || item.status === "skipped");
        return { id: "android/hierarchy-findings", label: "Android hierarchy findings across checks", method: "android-hierarchy-heuristics", unit: "finding", aggregation: "sum-across-checks", scope: { runId: result.runId, executionId: execution.executionId, profileId: execution.profileId, operationIds: execution.operations.map((op) => op.operationId) }, status: !checked.length ? "unavailable" : complete ? "available" : "partial", value: checked.length ? checked.flatMap((item) => item.checks).filter((check) => check.status === "finding").length : null, ...(!checked.length ? { reason: "No completed hierarchy checks." } : !complete ? { reason: "Execution or hierarchy collection did not complete." } : {}) };
      });
      const findings = androidAccessibilityFindings(evidence, result.runId);
      return immutableSnapshot({ id: configuredOptions.reportId, kind: "android-accessibility", measurements, evidence: { journal: evidence, report }, errors: configuredOptions.strict && findings.length ? [{ name: "AndroidStrictError", message: `Android hierarchy checks recorded ${findings.length} potential finding(s).` }] : [] });
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
    const { href } = await options.writeArtifact({ name: `${prefix}.hierarchy.xml`, data: xml, contentType: "application/xml", scope: { runId: target.runId, executionId: target.executionId, profileId: target.profileId, operationId: target.operation.id } });
    return { nodes, artifact: { href } };
  });
  const metrics = await capture(() => observation.session.deviceMetrics());
  const screenshot = options.screenshots ? await capture(async () => {
    const data = Buffer.from(await observation.session.screenshot(), "base64");
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Native screenshot is not a PNG image");
    const { href } = await options.writeArtifact({ name: `${prefix}.png`, data, contentType: "image/png", scope: { runId: target.runId, executionId: target.executionId, profileId: target.profileId, operationId: target.operation.id } });
    return { href };
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
function identityHash(value: string): string {
  return [...value].reduce((hash, char) => BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 1099511628211n), 14695981039346656037n).toString(16);
}
