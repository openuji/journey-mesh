# Step 1: Separate Journey Execution from Publication

Review and refactor the `feature/reporting` branch of `openuji/journey-mesh`.

## Objective

Make `runJourney()` responsible only for executing the journey and returning the final `RunResult`.

Report generation and publication must happen afterward through `reportJourneyResult()`.

Fix the current lifecycle bug where reporters run before `onRunCompleted` observers, meaning published output can differ from the result returned to the caller.

Do not add live progress events in this step.

## Required changes

### 1. Restore a green baseline

Before changing architecture:

* remove stale imports from `@openuji/journey-evidence`;
* update tests that still reference `result.evidence.events`;
* align tests with the current `RunResult` contract;
* preserve meaningful test coverage rather than deleting failing tests.

Verify the branch builds and tests before continuing.

### 2. Remove reporting from `runJourney()`

Remove `reporters` from `RunJourneyOptions`.

Target API:

```ts
const result = await runJourney({
  plan,
  adapter,
  profiles,
  observers
});
```

`runJourney()` must contain no:

* `ReporterPipeline`;
* reporter iteration;
* reporter JSON serialization;
* reporter error handling;
* publication logic.

### 3. Finalize lifecycle observers before returning

Target execution order:

```text
1. Run-start observers
2. Execute profiles
3. Execution-completed observers
4. Run-completed observers
5. Build final RunResult
6. Return final RunResult
```

A run-completed observer failure must be present in the returned result.

Use explicit intermediate naming where required:

```ts
const resultBeforeRunCompletion = buildResult(...);

const completionError =
  await observerDispatcher.runCompleted(
    resultBeforeRunCompletion
  );

// Add completion error if present.

const finalResult = buildResult(...);
return finalResult;
```

Do not publish `resultBeforeRunCompletion`.

### 4. Make reporting a separate operation

Keep the current reporter implementations temporarily, but change the reporting API so publication failures cannot mutate the journey result.

```ts
export type ReportJourneyResultInput = {
  readonly result: RunResult;
  readonly reporters:
    readonly JourneyReporter[];
};

export type ReportJourneyResultOutcome = {
  /**
   * Exact result supplied by the caller.
   */
  readonly result: RunResult;

  /**
   * Failures produced while writing,
   * attaching, rendering, or uploading output.
   */
  readonly errors:
    readonly JourneyRunError[];
};
```

Implementation:

```ts
export async function reportJourneyResult(
  input: ReportJourneyResultInput
): Promise<ReportJourneyResultOutcome> {
  const pipeline = new ReporterPipeline();

  const reporting = await pipeline.run({
    result: input.result,
    reporters: input.reporters
  });

  return {
    result: input.result,
    errors: reporting.errors
  };
}
```

Reporting failures must not:

* change `RunResult.ok`;
* append to `RunResult.errors`;
* replace execution errors;
* modify execution evidence.

Keep the existing `JourneyReporter` contract, including its `json` input, for now.

### 5. Update the example

Normal execution:

```ts
const result = await runJourney({
  plan,
  adapter,
  profiles
});

const reporting =
  await reportJourneyResult({
    result,
    reporters: [
      evidence,
      axe,
      summary
    ]
  });
```

Preflight failure:

```ts
const result =
  preflightFailureResult({
    errors: preflightErrors,
    plan
  });

const reporting =
  await reportJourneyResult({
    result,
    reporters
  });
```

The normal and preflight paths should use the same publication API.

Assert execution and publication separately:

```ts
expect(
  result.ok,
  failureSummary(result)
).toBe(true);

expect(
  reporting.errors,
  reportingFailureSummary(
    reporting.errors
  )
).toEqual([]);
```

## Tests

Add tests proving:

1. `runJourney()` never invokes reporters.
2. Run-completed observers run before `runJourney()` returns.
3. Run-completed observer failures appear in the returned result.
4. Reporters receive the exact final result object.
5. Every reporter receives the same result object.
6. Reporter failure does not change `RunResult.ok`.
7. Reporter failure does not change `RunResult.errors`.
8. Later reporters run after an earlier reporter fails.
9. Preflight and normal execution use the same reporting API.

## Acceptance criteria

The visible boundary is:

```ts
const result =
  await runJourney(executionOptions);

const reporting =
  await reportJourneyResult({
    result,
    reporters
  });
```

All commands pass:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

## Non-goals

Do not yet:

* introduce progress sinks or progress events;
* introduce assessments;
* split Axe collection from strict policy;
* introduce logical or published artifacts;
* remove reporter ordering dependencies;
* remove `JourneyReporterInput.json`;
* move Playwright reporting files;
* create a new reporting package;
* add `runAndReportJourney()`.

## Commit

```text
refactor(reporting): separate publication from journey execution
```
