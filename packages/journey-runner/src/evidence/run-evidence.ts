import {
  componentEvidence,
  errorToEvidence,
  referencesForPlan,
  type EvidenceError,
  type EvidenceSink
} from "@openuji/journey-evidence";

import type {
  JourneyAdapter,
  JourneyObserver,
  JourneyPlan,
  JourneyProfile,
  JourneyReporter
} from "../index.js";

export type RunStartedEvidenceInput = {
  readonly plan: JourneyPlan;
  readonly profiles: readonly JourneyProfile[];
  readonly adapter: JourneyAdapter;
  readonly observers: readonly JourneyObserver[];
  readonly reporters: readonly JourneyReporter[];
};

export type RunCompletedEvidenceInput = {
  readonly plan: JourneyPlan;
  readonly ok: boolean;
  readonly executionCount: number;
  readonly errorCount: number;
};

export class RunEvidence {
  constructor(private readonly sink: EvidenceSink) {}

  runStarted(input: RunStartedEvidenceInput): void {
    this.sink.emit({
      type: "runner.run.started",
      ok: true,
      references: referencesForPlan(input.plan),
      data: {
        planId: input.plan.id,
        operationCount: input.plan.operations.length,
        profiles: input.profiles.map((profile) => profile.id),
        adapter: componentEvidence(input.adapter),
        observers: input.observers.map(componentEvidence),
        reporters: input.reporters.map(componentEvidence)
      }
    });
  }

  runCompleted(input: RunCompletedEvidenceInput): void {
    this.sink.emit({
      type: "runner.run.completed",
      ok: input.ok,
      references: referencesForPlan(input.plan),
      data: {
        planId: input.plan.id,
        executionCount: input.executionCount,
        errorCount: input.errorCount
      }
    });
  }

  reporterStarted(reporter: JourneyReporter): void {
    this.sink.emit({
      type: "reporter.started",
      ok: true,
      data: componentEvidence(reporter)
    });
  }

  reporterCompleted(reporter: JourneyReporter): void {
    this.sink.emit({
      type: "reporter.completed",
      ok: true,
      data: componentEvidence(reporter)
    });
  }

  reporterFailed(reporter: JourneyReporter, error: unknown): void {
    this.sink.emit({
      type: "reporter.failed",
      ok: false,
      data: componentEvidence(reporter),
      error: toEvidenceError(error)
    });
  }

  observerRunStarted(observer: JourneyObserver): void {
    this.sink.emit({
      type: "observer.run-started.started",
      ok: true,
      data: componentEvidence(observer)
    });
  }

  observerRunStartCompleted(observer: JourneyObserver): void {
    this.sink.emit({
      type: "observer.run-started.completed",
      ok: true,
      data: componentEvidence(observer)
    });
  }

  observerRunStartFailed(observer: JourneyObserver, error: unknown): void {
    this.sink.emit({
      type: "observer.run-started.failed",
      ok: false,
      data: componentEvidence(observer),
      error: toEvidenceError(error)
    });
  }

  observerRunCompleted(observer: JourneyObserver): void {
    this.sink.emit({
      type: "observer.run-completed.started",
      ok: true,
      data: componentEvidence(observer)
    });
  }

  observerRunCompletionCompleted(observer: JourneyObserver): void {
    this.sink.emit({
      type: "observer.run-completed.completed",
      ok: true,
      data: componentEvidence(observer)
    });
  }

  observerRunCompletionFailed(observer: JourneyObserver, error: unknown): void {
    this.sink.emit({
      type: "observer.run-completed.failed",
      ok: false,
      data: componentEvidence(observer),
      error: toEvidenceError(error)
    });
  }
}

function toEvidenceError(error: unknown): EvidenceError {
  if (isEvidenceError(error)) return error;
  return errorToEvidence(error);
}

function isEvidenceError(value: unknown): value is EvidenceError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as EvidenceError).name === "string" &&
    typeof (value as EvidenceError).message === "string"
  );
}
