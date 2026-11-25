import { immutableSnapshot, type JourneyMeasurement } from "@openuji/journey-core";
import type { IosAppiumExecutionObserver, IosAppiumOperationObservation } from "@openuji/journey-executor-appium/observation";
import { errorToJourneyRunError, type RunResult } from "@openuji/journey-runner";
import type { IosAccessibilityEvidence, IosArtifactWriter, IosCapture, IosOperationEvidence } from "./evidence.js";
import { checkIosHierarchy, parseIosHierarchy, redactIosHierarchy } from "./hierarchy.js";
import { assessIosOperations, iosAccessibilityFindings, iosAccessibilityKind } from "./classify.js";
import type { IosAccessibilityObserverOutput } from "./output.js";

export * from "./evidence-entry.js";
export { checkIosHierarchy, parseIosHierarchy, redactIosHierarchy } from "./hierarchy.js";

export type IosAccessibilityObserverOptions = Readonly<{
  reportId: string;
  writeArtifact: IosArtifactWriter;
  screenshots?: boolean;
  strict?: boolean;
  excludedPhaseIds?: readonly string[];
  now?: () => string;
}>;
export type IosAccessibilityObserver = IosAppiumExecutionObserver & {
  readonly evidence: readonly IosAccessibilityEvidence[];
  output(result: RunResult): IosAccessibilityObserverOutput;
};

export function iosAccessibilityObserver(options: IosAccessibilityObserverOptions): IosAccessibilityObserver {
  const configuredOptions = Object.freeze({
    ...options,
    excludedPhaseIds: Object.freeze([...(options.excludedPhaseIds ?? [])])
  });
  let facts: readonly IosAccessibilityEvidence[] = Object.freeze([]);
  const append = (fact: IosAccessibilityEvidence) => {
    facts = Object.freeze([...facts, immutableSnapshot(fact)]);
  };
  return {
    name: "@openuji/journey-observer-ios-accessibility",
    version: "0.1.0",
    get evidence() {
      return facts;
    },
    onExecutionStarted({ execution }) {
      append(immutableSnapshot({ kind: "execution-started", execution }));
    },
    async observeOperation(observation) {
      const collected = await collectIosEvidence(observation, configuredOptions, facts.length);
      append({ kind: "operation-observed", evidence: collected });
      const failures = [collected.hierarchy, collected.metrics, collected.screenshot].flatMap((capture) =>
        capture?.kind === "failed" ? [capture.error] : []
      );
      if (failures.length) throw new Error(`iOS evidence collection failed: ${failures.map((error) => error.message).join("; ")}`);
    },
    output(result) {
      const evidence = facts.filter((fact) =>
        fact.kind === "execution-started" ? fact.execution.runId === result.runId : fact.evidence.runId === result.runId
      );
      const assessments = assessIosOperations(evidence, result);
      const measurements: JourneyMeasurement[] = result.evidence.executions.map((execution) => {
        const items = assessments.filter((item) => item.executionId === execution.executionId);
        const checked = items.filter((item) => item.status === "checked");
        const complete =
          result.executions.find((item) => item.executionId === execution.executionId)?.outcome.kind === "passed" &&
          !items.some((item) => item.status === "error" || item.status === "skipped");
        return {
          id: "ios/hierarchy-findings",
          label: "iOS hierarchy findings across checks",
          method: "ios-hierarchy-heuristics",
          unit: "finding",
          aggregation: "sum-across-checks",
          scope: {
            runId: result.runId,
            executionId: execution.executionId,
            profileId: execution.profileId,
            operationIds: execution.operations.map((op) => op.operationId)
          },
          status: !checked.length ? "unavailable" : complete ? "available" : "partial",
          value: checked.length ? checked.flatMap((item) => item.checks).filter((check) => check.status === "finding").length : null,
          ...(!checked.length
            ? { reason: "No completed hierarchy checks." }
            : !complete
              ? { reason: "Execution or hierarchy collection did not complete." }
              : {})
        };
      });
      const findings = iosAccessibilityFindings(evidence, result.runId);
      const recorded = {
        reportId: configuredOptions.reportId,
        createdAt: (configuredOptions.now ?? (() => new Date().toISOString()))(),
        strict: configuredOptions.strict ?? false,
        journal: evidence
      };
      return immutableSnapshot({
        id: configuredOptions.reportId,
        kind: iosAccessibilityKind,
        measurements,
        evidence: recorded,
        errors:
          configuredOptions.strict && findings.length
            ? [{ name: "IosStrictError", message: `iOS hierarchy checks recorded ${findings.length} potential finding(s).` }]
            : []
      });
    }
  };
}

async function collectIosEvidence(
  observation: IosAppiumOperationObservation,
  options: IosAccessibilityObserverOptions,
  index: number
): Promise<IosOperationEvidence> {
  const target = immutableSnapshot({
    runId: observation.execution.runId,
    executionId: observation.execution.executionId,
    profileId: observation.execution.profile.id,
    operation: observation.operation,
    stage: observation.stage
  });
  const phaseId = operationPhaseId(observation.operation);
  if (phaseId && options.excludedPhaseIds?.includes(phaseId)) {
    return immutableSnapshot({
      ...target,
      notApplicable: { phaseId, reason: `Phase ${phaseId} is excluded from accessibility capture.` },
      checks: []
    });
  }
  if (observation.stage === "transition-completed" || observation.stage === "control-flow-recorded") {
    return immutableSnapshot({ ...target, checks: [] });
  }
  const targets = Object.freeze(observation.targets.map((element) => element.elementId));
  const expectedMatchCount = observation.expectedMatchCount;
  const prefix = `ios-${identityHash(JSON.stringify([target.runId, target.executionId, target.operation.id]))}-${index}`;
  const hierarchy = await capture(async () => {
    const xml = redactIosHierarchy(await observation.session.source());
    const nodes = parseIosHierarchy(xml);
    const { href } = await options.writeArtifact({
      name: `${prefix}.hierarchy.xml`,
      data: xml,
      contentType: "application/xml",
      scope: {
        runId: target.runId,
        executionId: target.executionId,
        profileId: target.profileId,
        operationId: target.operation.id
      }
    });
    return { nodes, artifact: { href } };
  });
  const metrics = await capture(() => observation.session.deviceMetrics());
  const screenshot = options.screenshots
    ? await capture(async () => {
        const data = Buffer.from(await observation.session.screenshot(), "base64");
        if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
          throw new Error("Native screenshot is not a PNG image");
        }
        const { href } = await options.writeArtifact({
          name: `${prefix}.png`,
          data,
          contentType: "image/png",
          scope: {
            runId: target.runId,
            executionId: target.executionId,
            profileId: target.profileId,
            operationId: target.operation.id
          }
        });
        return { href };
      })
    : { kind: "not-requested" as const };
  const checks =
    hierarchy.kind === "captured"
      ? checkIosHierarchy(hierarchy.value.nodes, metrics.kind === "captured" ? metrics.value : {})
      : [];
  return immutableSnapshot({ ...target, expectedMatchCount, targets, hierarchy, metrics, screenshot, checks });
}

function operationPhaseId(operation: IosAppiumOperationObservation["operation"]): string | undefined {
  const value = operation.source?.references?.phaseId;
  return typeof value === "string" ? value : undefined;
}

async function capture<T>(read: () => Promise<T>): Promise<IosCapture<T>> {
  try {
    return { kind: "captured", value: await read() };
  } catch (error) {
    return { kind: "failed", error: errorToJourneyRunError(error) };
  }
}

function identityHash(value: string): string {
  return [...value]
    .reduce((hash, char) => BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 1099511628211n), 14695981039346656037n)
    .toString(16);
}
