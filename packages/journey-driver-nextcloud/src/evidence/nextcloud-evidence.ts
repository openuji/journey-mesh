import type {
  ControlFlowPlanOperation,
  JourneyPlanOperation
} from "@openuji/journey-runner";
import {
  referencesForOperation,
  type ExecutionEvidenceSink
} from "@openuji/journey-evidence";
import type { PlaywrightDriverExecutionContext } from "@openuji/journey-adapter-playwright";

import type { NextcloudActorSession } from "../index.js";

export class NextcloudEvidence {
  constructor(
    private readonly context: PlaywrightDriverExecutionContext,
    private readonly sink: ExecutionEvidenceSink
  ) {}

  executionSetupStarted(): void {
    this.sink.emit({
      type: "nextcloud.execution.setup.started",
      ok: true
    });
  }

  executionSetupCompleted(): void {
    this.sink.emit({
      type: "nextcloud.execution.setup.completed",
      ok: true
    });
  }

  entryOpened(
    operation: JourneyPlanOperation,
    session: NextcloudActorSession
  ): void {
    this.sink.emit({
      type: "nextcloud.entry.opened",
      operationId: operation.id,
      operationKind: operation.kind,
      ok: true,
      references: referencesForOperation(this.context.plan, operation),
      data: {
        entryBindingValue: operation.entryBinding?.value ?? null,
        baseURL: String(session.touchpoint.baseURL)
      }
    });
  }

  controlFlowRecorded(operation: ControlFlowPlanOperation): void {
    this.sink.emit({
      type: "nextcloud.control-flow.recorded",
      operationId: operation.id,
      operationKind: operation.kind,
      ok: true,
      references: referencesForOperation(this.context.plan, operation),
      data: {
        fromExitRef: operation.transition.fromExitRef ?? null,
        toEntryRef: operation.transition.toEntryRef ?? null
      }
    });
  }

  executionTeardownCompleted(): void {
    this.sink.emit({
      type: "nextcloud.execution.teardown.completed",
      ok: true
    });
  }

  actorSessionCreated(
    operation: JourneyPlanOperation,
    session: NextcloudActorSession
  ): void {
    this.sink.emit({
      type: "nextcloud.actor.session.created",
      ok: true,
      references: referencesForOperation(this.context.plan, operation),
      data: {
        username: session.user.username,
        baseURL: String(session.touchpoint.baseURL)
      }
    });
  }
}
