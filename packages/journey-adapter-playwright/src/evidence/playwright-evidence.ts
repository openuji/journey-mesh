import type {
  InputModalityDecision,
  JourneyExecutionContext,
  JourneyPlanOperation,
  StatePlanOperation,
  TransitionPlanOperation
} from "@openuji/journey-runner";
import {
  componentEvidence,
  errorToEvidence,
  referencesForOperation,
  type EvidenceError,
  type ExecutionEvidenceSink
} from "@openuji/journey-evidence";

import type {
  PlaywrightCreateBrowserContextInput,
  PlaywrightJourneyDriver
} from "../index.js";
import type {
  PlaywrightExecutionObserver,
  PlaywrightOperationObservation
} from "../observers/contracts.js";

export type PlaywrightBrowserContextEvidenceRecord = {
  readonly id: string;
  readonly label: string;
};

export class PlaywrightEvidence {
  constructor(
    private readonly context: JourneyExecutionContext,
    private readonly sink: ExecutionEvidenceSink
  ) {}

  browserStarted(input: {
    readonly owned: boolean;
    readonly headless: boolean | null;
    readonly driver: PlaywrightJourneyDriver;
  }): void {
    this.sink.emit({
      type: input.owned ? "playwright.browser.launched" : "playwright.browser.attached",
      ok: true,
      data: {
        headless: input.headless,
        owned: input.owned,
        driver: componentEvidence(input.driver)
      }
    });
  }

  browserStopped(input: { readonly owned: boolean }): void {
    this.sink.emit({
      type: input.owned ? "playwright.browser.closed" : "playwright.browser.released",
      ok: true
    });
  }

  assertionCompleted(operation: StatePlanOperation): void {
    this.sink.emit({
      type: "playwright.assertion.completed",
      operationId: operation.id,
      operationKind: operation.kind,
      ok: true,
      references: referencesForOperation(this.context.plan, operation),
      data: {
        expectedMatchCount: operation.target.expectedMatchCount
      }
    });
  }

  transitionCompleted(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision
  ): void {
    this.sink.emit({
      type: "playwright.transition.completed",
      operationId: operation.id,
      operationKind: operation.kind,
      ok: true,
      references: referencesForOperation(this.context.plan, operation),
      data: {
        command: decision.command,
        inputModalityProfileId: decision.inputModalityProfile.id,
        modalityId: decision.modality.id
      }
    });
  }

  browserContextCreated(
    managedContext: PlaywrightBrowserContextEvidenceRecord,
    input: PlaywrightCreateBrowserContextInput
  ): void {
    this.sink.emit({
      type: "playwright.context.created",
      ok: true,
      data: {
        id: managedContext.id,
        label: managedContext.label,
        operationId: input.operation?.id ?? null,
        ...(input.data ? { input: input.data } : {})
      }
    });
  }

  traceStarted(managedContext: PlaywrightBrowserContextEvidenceRecord): void {
    this.sink.emit({
      type: "playwright.trace.started",
      ok: true,
      data: { contextId: managedContext.id, label: managedContext.label }
    });
  }

  screenshotAttached(
    managedContext: PlaywrightBrowserContextEvidenceRecord,
    _pageIndex: number,
    path: string
  ): void {
    this.sink.emit({
      type: "playwright.screenshot.attached",
      ok: true,
      data: { contextId: managedContext.id, label: managedContext.label, path }
    });
  }

  screenshotFailed(
    managedContext: PlaywrightBrowserContextEvidenceRecord,
    _pageIndex: number,
    path: string,
    error: unknown
  ): void {
    this.artifactFailure("playwright.screenshot.failed", managedContext, error, { path });
  }

  traceAttached(
    managedContext: PlaywrightBrowserContextEvidenceRecord,
    path: string
  ): void {
    this.sink.emit({
      type: "playwright.trace.attached",
      ok: true,
      data: { contextId: managedContext.id, label: managedContext.label, path }
    });
  }

  traceFailed(
    managedContext: PlaywrightBrowserContextEvidenceRecord,
    path: string | undefined,
    error: unknown
  ): void {
    this.artifactFailure("playwright.trace.failed", managedContext, error, {
      path: path ?? null
    });
  }

  videoAttached(
    managedContext: PlaywrightBrowserContextEvidenceRecord,
    _pageIndex: number,
    path: string
  ): void {
    this.sink.emit({
      type: "playwright.video.attached",
      ok: true,
      data: { contextId: managedContext.id, label: managedContext.label, path }
    });
  }

  videoFailed(
    managedContext: PlaywrightBrowserContextEvidenceRecord,
    _pageIndex: number,
    error: unknown
  ): void {
    this.artifactFailure("playwright.video.failed", managedContext, error);
  }

  browserContextCloseFailed(
    managedContext: PlaywrightBrowserContextEvidenceRecord,
    error: unknown
  ): void {
    this.artifactFailure("playwright.context.close.failed", managedContext, error);
  }

  observerExecutionStarted(observer: PlaywrightExecutionObserver): void {
    this.observerExecutionEvent(
      "playwright.observer.execution-started.started",
      observer,
      true
    );
  }

  observerExecutionStartCompleted(observer: PlaywrightExecutionObserver): void {
    this.observerExecutionEvent(
      "playwright.observer.execution-started.completed",
      observer,
      true
    );
  }

  observerExecutionStartFailed(
    observer: PlaywrightExecutionObserver,
    error: unknown
  ): void {
    this.observerExecutionEvent(
      "playwright.observer.execution-started.failed",
      observer,
      false,
      toEvidenceError(error)
    );
  }

  observerOperationStarted(
    observer: PlaywrightExecutionObserver,
    observation: PlaywrightOperationObservation
  ): void {
    this.observerOperationEvent("playwright.observer.operation.started", observer, observation, true);
  }

  observerOperationCompleted(
    observer: PlaywrightExecutionObserver,
    observation: PlaywrightOperationObservation
  ): void {
    this.observerOperationEvent("playwright.observer.operation.completed", observer, observation, true);
  }

  observerOperationFailed(
    observer: PlaywrightExecutionObserver,
    observation: PlaywrightOperationObservation,
    error: unknown
  ): void {
    this.observerOperationEvent(
      "playwright.observer.operation.failed",
      observer,
      observation,
      false,
      toEvidenceError(error)
    );
  }

  private observerExecutionEvent(
    type: string,
    observer: PlaywrightExecutionObserver,
    ok: boolean,
    error?: EvidenceError
  ): void {
    this.sink.emit({
      type,
      ok,
      data: {
        observer: componentEvidence(observer)
      },
      error
    });
  }

  private observerOperationEvent(
    type: string,
    observer: PlaywrightExecutionObserver,
    observation: PlaywrightOperationObservation,
    ok: boolean,
    error?: EvidenceError
  ): void {
    this.sink.emit({
      type,
      operationId: operationId(observation.operation),
      operationKind: observation.operation.kind,
      ok,
      data: {
        observer: componentEvidence(observer),
        stage: observation.stage
      },
      error
    });
  }

  private artifactFailure(
    type: string,
    managedContext: PlaywrightBrowserContextEvidenceRecord,
    error: unknown,
    extraData: Record<string, string | null> = {}
  ): void {
    this.sink.emit({
      type,
      ok: false,
      error: toEvidenceError(error),
      data: {
        contextId: managedContext.id,
        label: managedContext.label,
        ...extraData
      }
    });
  }
}

function operationId(operation: JourneyPlanOperation): string {
  return operation.id;
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
