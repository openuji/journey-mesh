# Step 2: Add Non-Blocking Journey Progress Events

Work on the `feature/reporting` branch after Step 1 is complete.

## Objective

Expose accurate live execution progress from `runJourney()`.

Progress must describe what is happening during execution:

```text
run started
execution started
operation started
operation completed or failed
execution completed
run completed
```

Progress is ephemeral output for consoles, CI logs, UIs, or WebSockets. It is not durable reporting and must not modify `RunResult`.

## Target API

Add:

```ts
export type JourneyProgressSink = {
  readonly name?: string;

  publish(
    event: JourneyProgressEvent
  ): Promise<void> | void;
};
```

Extend execution options:

```ts
export type RunJourneyOptions = {
  plan: JourneyPlan;
  adapter: JourneyAdapter;
  profiles: JourneyProfile[];
  observers?: JourneyObserver[];
  progress?: readonly JourneyProgressSink[];
  runId?: string;
};
```

Do not call these `progressObservers`. They are narrow, write-only sinks rather than lifecycle plugins.

## Event contract

```ts
export type JourneyProgressEvent =
  | {
      readonly type: "run-started";
      readonly runId: string;
      readonly planId: string;
      readonly profileCount: number;
      readonly operationsPerProfile: number;
    }
  | {
      readonly type: "execution-started";
      readonly runId: string;
      readonly executionId: string;
      readonly profileId: string;
    }
  | {
      readonly type: "operation-started";
      readonly executionId: string;
      readonly profileId: string;
      readonly operation: JourneyPlanOperation;
      readonly position: number;
      readonly total: number;
    }
  | {
      readonly type: "operation-completed";
      readonly executionId: string;
      readonly profileId: string;
      readonly operation: JourneyPlanOperation;
      readonly position: number;
      readonly total: number;
      readonly durationMs: number;
    }
  | {
      readonly type: "operation-failed";
      readonly executionId: string;
      readonly profileId: string;
      readonly operation: JourneyPlanOperation;
      readonly position: number;
      readonly total: number;
      readonly durationMs: number;
      readonly error: JourneyRunError;
    }
  | {
      readonly type: "execution-completed";
      readonly executionId: string;
      readonly profileId: string;
      readonly ok: boolean;
      readonly durationMs: number;
    }
  | {
      readonly type: "run-completed";
      readonly runId: string;
      readonly ok: boolean;
      readonly durationMs: number;
    };
```

Use one-based `position`.

Do not include the full `RunResult` in progress events.

## Delivery semantics

Create a small dispatcher:

```ts
class JourneyProgressDispatcher {
  constructor(
    private readonly sinks:
      readonly JourneyProgressSink[]
  ) {}

  async publish(
    event: JourneyProgressEvent
  ): Promise<void> {
    for (const sink of this.sinks) {
      try {
        await sink.publish(event);
      } catch {
        // Progress delivery is best-effort.
      }
    }
  }
}
```

A progress sink failure must never:

* fail the journey;
* change `RunResult.ok`;
* appear in `RunResult.errors`;
* prevent later sinks from receiving the event;
* prevent later operations from running.

Do not silently catch journey execution errors—only progress delivery errors.

## Runner integration

Measure durations with `performance.now()`.

Publish `operation-started` immediately before all operation work, including entry opening and modality selection.

Publish exactly one terminal operation event:

```text
operation-completed
operation-failed
```

Example:

```ts
const startedAt = performance.now();

await progress.publish({
  type: "operation-started",
  executionId: context.executionId,
  profileId: profile.id,
  operation,
  position: index + 1,
  total: plan.operations.length
});

try {
  await executeOperation(...);

  await progress.publish({
    type: "operation-completed",
    executionId: context.executionId,
    profileId: profile.id,
    operation,
    position: index + 1,
    total: plan.operations.length,
    durationMs: performance.now() - startedAt
  });
} catch (error) {
  const runError =
    errorToJourneyRunError(error);

  await progress.publish({
    type: "operation-failed",
    executionId: context.executionId,
    profileId: profile.id,
    operation,
    position: index + 1,
    total: plan.operations.length,
    durationMs: performance.now() - startedAt,
    error: runError
  });

  throw runError;
}
```

Publish `execution-completed` after execution-completed observers have finished, using the final execution status.

Publish `run-completed` immediately before `runJourney()` returns its final result.

## Add a console progress sink

Add a simple reusable implementation, preferably in the runner initially:

```ts
export function consoleJourneyProgress(
  options?: {
    readonly stream?: Pick<
      NodeJS.WriteStream,
      "write"
    >;
  }
): JourneyProgressSink;
```

Example output:

```text
Profile: default

  1/15 Checking "Alice files ready"...
       ✓ completed in 420ms

  2/15 Performing "Alice opens file menu"...
       ✗ failed after 30.0s
         Expected one matching textbox, found 0
```

Use operation label when available, otherwise operation ID.

Do not print `transition-ready` as completed. Playwright-specific readiness remains part of Playwright observer instrumentation.

## Example usage

```ts
const result = await runJourney({
  plan,
  adapter,
  profiles,
  progress: [
    consoleJourneyProgress()
  ]
});

const reporting =
  await reportJourneyResult({
    result,
    reporters
  });
```

## Tests

Add tests proving:

1. Events are emitted in lifecycle order.
2. Every started operation has exactly one terminal event.
3. Failed operations include duration and serialized error.
4. Positions are one-based.
5. Execution and run completion use final status.
6. A failing progress sink does not affect the journey.
7. Later sinks still receive events after one sink fails.
8. Progress events are emitted before final reporting begins.
9. The console sink renders success and failure output.
10. Playwright observers remain unchanged.

## Non-goals

Do not:

* make progress durable evidence;
* add progress events to `RunResult`;
* use progress sinks for Axe;
* replace runner lifecycle observers;
* add WebSocket or UI implementations;
* introduce artifact manifests;
* redesign final reporting;
* add Playwright-specific data to generic progress events.

## Commit

```text
feat(progress): add non-blocking journey execution progress
```
