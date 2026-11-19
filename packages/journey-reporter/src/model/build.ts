import type { JourneyPlanOperation } from "@openuji/journey-execution-model";
import { testDirectory, type EvidenceFile, type SuiteRun, type TestRecord } from "@openuji/journey-run-record";
import { selectJourneyMaps } from "../journey-maps.js";
import type { NodeSummary } from "../interpreter.js";
import {
  reportModelFormat, testModelFormat,
  type DataRef, type FileRef, type JourneyMapModel, type MapState, type ModelError, type NodeMetrics, type Outcome, type ProfileModel,
  type ReportError, type ReportModel, type StepModel, type StepOutcome, type TestModel, type TestSummary, type ViewRef
} from "./types.js";

/** What interpreters derived from one observer output. */
export type Interpreted = Readonly<{ observer: string; nodes: readonly NodeSummary[]; data: readonly DataRef[] }>;

/** Where a test model is written, relative to the run directory. */
export const testModelHref = (id: string) => `report/tests/${testDirectory(id)}.json`;

const error = ({ name, message }: ModelError): ModelError => ({ name, message });
const fileRef = (file: EvidenceFile): FileRef => ({ href: file.href, name: file.name, contentType: file.contentType,
  ...(file.format ? { format: file.format } : {}), ...(file.scope ? { scope: file.scope } : {}) });
const isImage = (file: EvidenceFile) => file.contentType === "image/png";

function stepLabel(operation: JourneyPlanOperation): string {
  return operation.kind === "state" ? operation.state.label ?? operation.state.id : operation.transition.label ?? operation.transition.id;
}
function phaseOf(operation: JourneyPlanOperation): string | undefined {
  const value = operation.source?.references?.phaseId;
  return typeof value === "string" ? value : undefined;
}
/** One operation may receive metrics from several interpreters; a measured result wins over `skipped`. */
function pickMetrics(nodes: readonly NodeSummary[]): NodeMetrics | undefined {
  return nodes.find((node) => node.metrics.kind !== "skipped")?.metrics ?? nodes[0]?.metrics;
}

function buildProfile(test: TestRecord, profileId: string, interpreted: readonly Interpreted[], maps: readonly JourneyMapModel[], excluded: ReadonlySet<string>): ProfileModel {
  const { result } = test;
  const assessment = result.assessments.find((item) => item.profile.id === profileId);
  const execution = result.executions.find((item) => item.profileId === profileId);
  const recorded = execution && result.evidence.executions.find((item) => item.executionId === execution.executionId);
  const scoped = (file: EvidenceFile) => !!execution && file.scope?.runId === result.runId && file.scope.executionId === execution.executionId;
  const nodes = execution ? interpreted.flatMap((item) => item.nodes).filter((node) => node.executionId === execution.executionId) : [];
  const steps = test.plan.operations.map((operation): StepModel => {
    const outcome = recorded?.operations.find((item) => item.operationId === operation.id)?.outcome;
    const files = test.files.filter((file) => scoped(file) && file.scope?.operationId === operation.id);
    const metrics = pickMetrics(nodes.filter((node) => node.operationId === operation.id));
    const phaseId = phaseOf(operation);
    return {
      id: operation.id, sequence: operation.sequence, kind: operation.kind,
      ...(operation.segment !== undefined ? { segment: operation.segment } : {}),
      touchpointId: operation.touchpointId, label: stepLabel(operation),
      ...(phaseId ? { phaseId } : {}), excluded: !!phaseId && excluded.has(phaseId),
      ...(operation.kind === "state" ? { stateId: operation.state.id } : { from: operation.transition.from, to: operation.transition.to }),
      outcome: (outcome?.kind ?? "not-executed") as StepOutcome,
      ...(outcome?.kind === "failed" ? { error: outcome.error.message } : {}),
      ...(metrics ? { metrics } : {}),
      screenshots: files.filter(isImage).map(fileRef), files: files.filter((file) => !isImage(file)).map(fileRef)
    };
  });
  const mapStates: Record<string, Record<string, MapState>> = {};
  if (execution) for (const map of maps) {
    const states: Record<string, MapState> = {};
    for (const step of steps) {
      if (!step.stateId || !map.segments.includes(step.segment ?? "")) continue;
      states[step.stateId] = { outcome: step.outcome, ...(step.error ? { error: step.error } : {}), ...(step.metrics ? { metrics: step.metrics } : {}),
        ...(step.screenshots[0] ? { screenshot: step.screenshots[0].href } : {}) };
    }
    mapStates[map.view] = states;
  }
  let outcome: Outcome = "not-executed";
  if (execution) outcome = execution.outcome.kind;
  else if (assessment?.kind === "not-applicable") outcome = "not-applicable";
  else if (assessment?.kind === "failed") outcome = "failed";
  const failure = execution?.outcome.kind === "failed" ? execution.outcome.error : assessment?.kind === "failed" ? assessment.error : undefined;
  return {
    id: profileId, ...(execution ? { executionId: execution.executionId } : {}), outcome,
    ...(failure ? { error: error(failure) } : {}),
    ...(assessment?.kind === "not-applicable" ? { reason: assessment.reason } : {}),
    steps, mapStates,
    measurements: execution ? test.observers.flatMap((output) => output.measurements.filter((metric) => metric.scope.executionId === execution.executionId)) : [],
    files: test.files.filter((file) => scoped(file) && !file.scope?.operationId).map(fileRef)
  };
}

/** Join a test record with interpreter results into the render-ready test model. Pure. */
export function buildTestModel(input: Readonly<{
  test: TestRecord; excludedPhaseIds: readonly string[]; views: Readonly<Record<string, ViewRef>>; interpreted: readonly Interpreted[];
}>): TestModel {
  const { test, interpreted } = input;
  const selection = selectJourneyMaps(test, input.excludedPhaseIds);
  const adapters = new Map(test.segments.map((segment) => [segment.id, segment.adapter]));
  const maps = selection.maps.map((map): JourneyMapModel => {
    const segments = map.segments.map((segment) => segment.id);
    const touchpoints: Record<string, string[]> = {};
    for (const operation of test.plan.operations) {
      const adapter = adapters.get(operation.segment ?? "");
      if (!adapter || !segments.includes(operation.segment ?? "")) continue;
      touchpoints[operation.touchpointId] = [...new Set([...(touchpoints[operation.touchpointId] ?? []), adapter])];
    }
    return { view: map.view, segments, rootStartIds: map.rootStartIds, touchpoints };
  });
  const profileIds = [...new Set([...test.result.assessments.map((item) => item.profile.id), ...test.result.executions.map((item) => item.profileId)])];
  const excluded = new Set(input.excludedPhaseIds);
  return {
    format: testModelFormat, version: 1, id: test.id, ok: test.ok,
    failures: [
      ...test.result.errors.map((item) => ({ ...error(item), source: "execution" as const })),
      ...[...test.observerErrors, ...test.observers.flatMap((output) => output.errors)].map((item) => ({ ...error(item), source: "observer" as const }))
    ],
    excludedPhaseIds: [...input.excludedPhaseIds],
    views: input.views,
    journeys: test.segments.map((segment) => ({ segmentId: segment.id, journeyId: segment.journeyId, adapter: segment.adapter, ...(segment.view ? { view: segment.view } : {}) })),
    maps, mapErrors: selection.errors,
    data: interpreted.flatMap((item) => item.data),
    files: test.files.filter((file) => !file.scope).map(fileRef),
    profiles: profileIds.map((id) => buildProfile(test, id, interpreted, maps, excluded))
  };
}

export function testSummary(model: TestModel): TestSummary {
  return {
    id: model.id, ok: model.ok, href: testModelHref(model.id),
    metricKinds: [...new Set(model.profiles.flatMap((profile) => profile.steps.flatMap((step) => step.metrics ? [step.metrics.kind] : [])))],
    profiles: model.profiles.map((profile) => ({ id: profile.id, outcome: profile.outcome, steps: profile.steps.length,
      failedSteps: profile.steps.filter((step) => step.outcome === "failed").length }))
  };
}

/** The report index of one run. Pure. */
export function buildReportModel(input: Readonly<{ run: SuiteRun; tests: readonly TestModel[]; errors: readonly ReportError[]; generatedAt: string }>): ReportModel {
  const { run } = input;
  return {
    format: reportModelFormat, version: 1, kind: "suite", generatedAt: input.generatedAt,
    ...(run.label ? { label: run.label } : {}), ...(run.target ? { target: run.target } : {}),
    ok: run.ok, startedAt: run.startedAt, finishedAt: run.finishedAt, provenance: run.provenance,
    runErrors: run.errors.map(error), errors: input.errors, files: run.files.map(fileRef),
    tests: input.tests.map(testSummary)
  };
}
