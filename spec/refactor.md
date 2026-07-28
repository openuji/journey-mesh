# Journey Runner Evidence and Execution Refactoring Plan

## Objective

Refactor the monorepo so that:

* execution state is represented by execution-scoped objects rather than maps keyed by `executionId`;
* contexts are bound once when an execution starts, not passed into every method;
* raw evidence events are constructed only inside package-local evidence projectors;
* adapters, drivers, artifact managers, observers, and operation executors contain semantic calls rather than `evidence.emit({...})`;
* evidence is write-only outside the runner and cannot be queried as application state;
* failures are accumulated rather than overwritten;
* package dependencies reflect the domain model rather than placing core journey types inside `journey-evidence`;
* the existing Nextcloud example remains the end-to-end acceptance scenario.

Do **not** solve this by adding `evidenceFor(context, operation)`, generic `capture(type, data, fn)` calls throughout business code, or another context object passed through every function.

---

# 1. Current runtime path

The main scenario starts in:

```text
examples/nextcloud-filesharing/run.ts
```

The example:

1. compiles a UJG document;
2. creates one Axe object that acts as both observer and reporter;
3. constructs the Nextcloud driver;
4. wraps it in the Playwright adapter;
5. calls `runJourney` with two profiles;
6. attaches the resulting evidence JSON to Playwright Test.

The workspace currently contains these runtime packages:

```text
journey-evidence
journey-runner
journey-model-ujg
journey-profiles
journey-adapter-playwright
journey-driver-nextcloud
journey-observer-axe
```

They are built as one TypeScript project graph.

The effective runtime path is:

```text
UJG document
    ↓
journey-model-ujg
    ↓
JourneyPlan
    ↓
journey-runner
    ↓
JourneyAdapter
    ↓
journey-adapter-playwright
    ↓
PlaywrightJourneyDriver
    ↓
journey-driver-nextcloud

Playwright operation observations
    ↓
journey-observer-axe
    ↓
Axe report
```

---

# 2. Primary architectural problems

## 2.1 Core domain types live in `journey-evidence`

`journey-evidence` declares:

* journey-plan operations;
* locators and bindings;
* modality decisions;
* effects and artifacts;
* evidence events;
* the in-memory recorder.

The plan model and evidence infrastructure therefore have the same package owner.

This causes the UJG compiler to depend on `journey-evidence` merely to produce a `JourneyPlan`.

## 2.2 The adapter contract is stateless in appearance but stateful in reality

Every adapter operation receives the entire execution context:

```ts
adapter.assertState(operation, context);
adapter.performTransition(operation, decision, context);
adapter.teardownExecution(context);
```

The context includes the plan, profile, global recorder, and observer list.

The Playwright adapter compensates by maintaining an execution map keyed by `executionId`. It also constructs a temporary invalid state using:

```ts
undefined as unknown as PlaywrightDriverExecutionContext
```

The Nextcloud driver repeats the same pattern with another execution map.

## 2.3 The global recorder is exposed everywhere

The runner passes the concrete `EvidenceRecorder` into adapters and observers. Those packages can both emit events and inspect the complete event history.

This causes artifact-retention policy to query the evidence log to infer whether an execution failed:

```ts
context.evidence.snapshot().some(...)
```

Evidence has become both output and hidden mutable application state.

## 2.4 Evidence serialization is mixed with behavior

Raw event construction exists in:

* runner lifecycle code;
* operation execution;
* observer dispatch;
* Playwright browser and context lifecycle;
* Playwright assertions and transitions;
* artifact capture;
* Nextcloud session and entry lifecycle.

For example, the runner manually emits before and after every adapter action.

The Nextcloud driver likewise constructs execution, entry, control-flow, and actor-session events directly inside driver behavior.

## 2.5 Observer layers are coupled through the adapter context

The runner places all observers in `AdapterExecutionContext`. The Playwright adapter then filters those generic observers using a runtime type guard to find Playwright-specific observers.

The Axe observer implements both the Playwright-specific observer and the runner reporter and stores mutable run state internally.

## 2.6 Failure information is overwritten

The runner stores only one `executionError`.

An operation failure can be replaced by:

* teardown failure;
* execution-completed observer failure.

The original failure is then lost. The overwrite is visible in the execution lifecycle.

## 2.7 The repository is organized into monolithic index files

Major implementation files currently combine contracts, orchestration, evidence mapping, state, utilities, and domain behavior:

```text
journey-runner/src/index.ts
journey-adapter-playwright/src/index.ts
journey-driver-nextcloud/src/index.ts
journey-observer-axe/src/index.ts
tests/run-tests.ts
```

The test suite also directly asserts low-level event strings and internal context behavior, including observer arrays inside adapter contexts.

---

# 3. Target package dependency graph

Introduce a new package:

```text
@openuji/journey-core
```

It must own only stable domain contracts:

```text
JsonValue
ComponentReference
JourneyPlan
JourneyPlanOperation
StatePlanOperation
TransitionPlanOperation
ControlFlowPlanOperation
ResolvedAccessibleLocator
ResolvedObservationBinding
InputModalityDecision
ExecutionOutcome and failure primitives
```

Target dependency graph:

```text
journey-core
    ├── journey-evidence
    ├── journey-model-ujg
    ├── journey-runner
    │     ├── journey-profiles
    │     └── journey-adapter-playwright
    │           ├── journey-driver-nextcloud
    │           └── journey-observer-axe
    └── example packages
```

Rules:

* `journey-core` has no workspace dependencies.
* `journey-evidence` depends on `journey-core`.
* `journey-model-ujg` depends on `journey-core`, not `journey-evidence`.
* The runner may re-export selected core and evidence types temporarily for migration compatibility.
* Profiles should ultimately depend on `journey-core` and the smallest runner contract surface possible.
* No package imports journey-plan types from `journey-evidence`.

---

# 4. Target adapter execution API

Replace the context-per-method contract with an execution-session contract.

## New adapter contract

```ts
export interface JourneyAdapter {
  readonly name: string;
  readonly version?: string;

  createExecution(
    context: AdapterExecutionStartContext
  ): JourneyAdapterExecution;
}

export interface JourneyAdapterExecution {
  start(): Promise<void>;

  openEntry(
    operation: JourneyPlanOperation
  ): Promise<void>;

  assertState(
    operation: StatePlanOperation
  ): Promise<void>;

  performTransition(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision
  ): Promise<void>;

  recordControlFlow(
    operation: ControlFlowPlanOperation
  ): Promise<void>;

  close(
    outcome: ExecutionOutcome
  ): Promise<void>;
}
```

## Start context

```ts
export interface AdapterExecutionStartContext {
  readonly runId: string;
  readonly executionId: string;
  readonly profile: JourneyProfile;
  readonly plan: JourneyPlan;

  /**
   * Write-only and already bound to this execution.
   * It must expose no snapshot/read API.
   */
  readonly evidence: ExecutionEvidenceSink;
}
```

Important behavior:

* `createExecution` is synchronous and returns an object even before resources are opened.
* `start()` performs asynchronous setup.
* The runner can therefore call `close()` after a partial or failed `start()`.
* All methods after creation operate on bound state and do not receive context.
* `close(outcome)` receives the explicit execution outcome.
* Adapters no longer inspect evidence to determine whether the execution failed.

---

# 5. Target Playwright driver API

Apply the same pattern one layer down.

```ts
export interface PlaywrightJourneyDriver {
  readonly name: string;
  readonly version?: string;

  createExecution(
    context: PlaywrightDriverStartContext
  ): PlaywrightDriverExecution;
}

export interface PlaywrightDriverExecution {
  start(): Promise<void>;

  openEntry(
    operation: JourneyPlanOperation
  ): Promise<void>;

  pageForOperation(
    operation: JourneyPlanOperation
  ): Promise<Page>;

  transitionValue(
    operation: TransitionPlanOperation
  ): Promise<string | undefined>;

  afterTransition(
    operation: TransitionPlanOperation,
    decision: InputModalityDecision
  ): Promise<void>;

  recordControlFlow(
    operation: ControlFlowPlanOperation
  ): Promise<void>;

  close(
    outcome: ExecutionOutcome
  ): Promise<void>;
}
```

Consequences:

* `journey-adapter-playwright` no longer has an `executions` map.
* `journey-driver-nextcloud` no longer has an `executions` map.
* `NextcloudExecution` owns its actor sessions directly.
* `PlaywrightExecution` owns browser contexts and artifact state directly.
* `requireExecutionState` disappears from both packages.
* `contextForExecution` recursion disappears from the Nextcloud driver.
* No operation method receives a driver context.

---

# 6. Evidence architecture

## 6.1 Split recording from reading

Replace the all-purpose recorder API with separate capabilities.

```ts
export interface EvidenceSink {
  emit(input: EvidenceEventInput): EvidenceEvent;
}

export interface EvidenceLog {
  snapshot(): readonly EvidenceEvent[];
}

export class InMemoryEvidenceRecorder
  implements EvidenceSink, EvidenceLog {
  // Existing sequence and timestamp behavior.
}
```

Only the runner composition root owns the concrete object with both capabilities.

Adapters, drivers, and observers receive at most a scoped write-only sink.

## 6.2 Bind identity once

```ts
export interface ExecutionEvidenceSink {
  emit(
    input: Omit<
      EvidenceEventInput,
      "executionId" | "profileId"
    >
  ): EvidenceEvent;
}
```

The runner creates it once:

```ts
const executionEvidence =
  evidenceScope.forExecution({
    executionId,
    profileId: profile.id
  });
```

This scope creation occurs inside `ProfileExecution`, not throughout application code.

## 6.3 Package-local semantic projectors

Each package gets one evidence class.

```text
journey-runner/src/evidence/runner-evidence.ts
journey-adapter-playwright/src/evidence/playwright-evidence.ts
journey-driver-nextcloud/src/evidence/nextcloud-evidence.ts
```

Example call sites:

```ts
this.evidence.executionStarted(profile);

this.evidence.assertionCompleted(operation);

this.evidence.transitionCompleted(
  operation,
  decision
);

this.evidence.browserContextCreated(
  managedContext,
  input
);

this.evidence.actorSessionCreated(
  operation,
  actorSession
);
```

Only evidence projector files may contain:

```ts
executionId
profileId
operationId
operationKind
UjgRefSet
context.evidence.emit
event type strings
componentData(...)
locator ID traversal
errorToEvidence(...)
```

Do not pass flattened evidence objects to these methods. Pass rich source objects such as operations, decisions, sessions, components, and outcomes.

## 6.4 Centralize UJG reference projection

Move the repeated ID extraction into `journey-evidence`:

```ts
export function ujgReferencesForOperation(
  operation: JourneyPlanOperation
): UjgRefSet;
```

Also provide focused helpers if necessary:

```ts
ujgReferencesForBindings(bindings)
locatorIdsFor(locators)
componentReference(component)
```

Runner, Playwright, and Nextcloud evidence projectors must reuse these functions rather than implementing different partial mappings.

## 6.5 Preserve event compatibility first

During structural refactoring:

* preserve existing event type strings;
* preserve existing `ujg` and `data` fields;
* preserve sequence and timestamp behavior;
* add characterization tests for event ordering and payloads.

Intentional event-schema improvements should happen only after the structural refactor.

The first intentional addition should be:

```text
operation.failed
```

Every started operation must end with exactly one of:

```text
operation.completed
operation.failed
```

---

# 7. Runner internal design

Create these internal objects:

```text
JourneyRun
ProfileExecution
OperationExecutor
EntryTracker
ObserverDispatcher
ReporterPipeline
RunResultBuilder
ExecutionOutcomeBuilder
```

## JourneyRun

Owns:

* run ID;
* plan;
* profiles;
* global evidence recorder;
* run evidence projector;
* execution results;
* reporter results;
* run-level failures.

`runJourney` becomes:

```ts
export function runJourney(
  options: RunJourneyOptions
): Promise<RunResult> {
  return new JourneyRun(options).run();
}
```

## ProfileExecution

Owns:

* one profile;
* execution ID;
* adapter execution session;
* profile decision policy;
* entry tracker;
* execution outcome;
* execution evidence projector.

Its main loop should resemble:

```ts
const session =
  adapter.createExecution(startContext);

try {
  await session.start();

  for (const operation of plan.operations) {
    await operations.execute(operation);
  }
} catch (error) {
  outcome.addFailure(...);
} finally {
  await closeSession(session, outcome);
}
```

No raw evidence emission belongs in this class.

## OperationExecutor

Core implementation:

```ts
interface OperationExecutor {
  execute(
    operation: JourneyPlanOperation
  ): Promise<OperationOutcome>;
}
```

Responsibilities:

* ensure the correct entry is open;
* assert state;
* select transition modality;
* perform transition;
* record control flow;
* return semantic operation outcome.

Instrumentation is applied through an `EvidenceOperationExecutor` decorator.

## EntryTracker

Replace `currentEntryByUser` and its free helper with:

```ts
class EntryTracker {
  ensureOpen(
    operation: JourneyPlanOperation,
    session: JourneyAdapterExecution
  ): Promise<void>;
}
```

## ObserverDispatcher

Own observer iteration and failure policy.

It must:

* call every observer for a stage;
* collect every observer failure;
* never expose `EvidenceRecorder` to observers;
* instrument observer lifecycle through `RunnerEvidence`.

Recommended policy:

* run-start observer failures prevent executions;
* execution-start observer failures prevent that execution from performing operations;
* execution-completed observer failures mark the execution failed;
* run-completed observer failures mark the run failed;
* all observers for the same stage should be attempted.

## ReporterPipeline

All reporters receive the same immutable pre-reporting result snapshot.

Do not rebuild the reporter input after every reporter.

Collect reporter outcomes separately:

```ts
export interface ReporterResult {
  reporter: ComponentReference;
  ok: boolean;
  error?: EvidenceError;
}
```

Build the final result only after the reporter pipeline finishes.

---

# 8. Failure model

Replace the single execution error with accumulated failures.

```ts
export type ExecutionFailurePhase =
  | "observer-start"
  | "adapter-start"
  | "operation"
  | "adapter-close"
  | "observer-complete";

export interface ExecutionFailure {
  phase: ExecutionFailurePhase;
  error: EvidenceError;
  operationId?: string;
  component?: ComponentReference;
}

export interface ExecutionResult {
  executionId: string;
  profileId: string;
  ok: boolean;
  failures: ExecutionFailure[];
}
```

At run level, add equivalent structured failures for:

* run observers;
* reporters;
* preflight/configuration.

For a compatibility period, `ExecutionResult.error` may be retained as:

```ts
error: failures[0]?.error
```

but all internal logic must use `failures`.

Add explicit tests where:

1. an operation fails;
2. teardown also fails;
3. an execution-completed observer also fails.

All three failures must remain available.

---

# 9. Playwright adapter refactoring

Create:

```text
packages/journey-adapter-playwright/src/
  index.ts
  contracts.ts
  adapter.ts
  playwright-execution.ts
  managed-browser-context.ts
  locators.ts
  interactions.ts
  artifacts/
    artifact-manager.ts
    artifact-options.ts
    artifact-sink.ts
  observers/
    playwright-observer.ts
    observer-dispatcher.ts
  evidence/
    playwright-evidence.ts
```

## PlaywrightExecution

Own:

* browser;
* whether the browser is owned;
* driver execution session;
* managed browser contexts;
* artifact manager;
* assertion timeout;
* Playwright evidence projector.

Its methods implement `JourneyAdapterExecution`.

## ArtifactManager

Move all of these into the service:

* browser-context option augmentation;
* tracing start/stop;
* screenshots;
* videos;
* artifact attachment;
* context closing;
* artifact failure handling;
* retention policy.

Its finalization API should be:

```ts
artifacts.finalize({
  contexts,
  retain: shouldRetainArtifacts(
    outcome,
    mode
  )
});
```

Retention must use the explicit `ExecutionOutcome`, never the evidence log.

## ManagedBrowserContext

Turn the mutable record into an object that owns:

* ID;
* label;
* browser context;
* tracked pages;
* trace state.

## Locator code

Delete `LocatorResolutionOptions`.

The current options object is threaded through locator functions even though the developed version no longer uses it for feature resolution.

Target signatures:

```ts
toPlaywrightObservationLocator(
  root,
  bindings
)

toPlaywrightLocator(
  root,
  locator
)
```

Locator utilities must have no knowledge of:

* execution context;
* driver;
* observers;
* evidence.

---

# 10. Nextcloud driver refactoring

Create:

```text
packages/journey-driver-nextcloud/src/
  index.ts
  contracts.ts
  driver.ts
  nextcloud-execution.ts
  actor-session-manager.ts
  evidence/
    nextcloud-evidence.ts
  api/
    ocs.ts
    webdav.ts
  browser/
    login.ts
    navigation.ts
  utilities/
    polling.ts
    environment.ts
```

Do not rewrite the OCS, WebDAV, login, or polling algorithms as part of the architecture migration. Move them mechanically.

## NextcloudExecution

Own:

* execution-bound Playwright context;
* actor-session map;
* user and touchpoint configuration;
* handler configuration;
* Nextcloud evidence projector.

`getSession(operation)` becomes an instance method.

The handlers should receive a narrow bound context, not the global runner or adapter context.

```ts
export interface NextcloudHandlerContext {
  readonly runId: string;
  readonly executionId: string;
  readonly profileId: string;

  getSession(
    operation: JourneyPlanOperation
  ): Promise<NextcloudActorSession>;
}
```

No evidence recorder or observer list is exposed.

---

# 11. Observer and Axe refactoring

## Remove observers from adapter execution context

`AdapterExecutionContext.observers` must be deleted.

Generic runner observers remain configured in `runJourney`.

Playwright-specific observers become explicit Playwright adapter configuration:

```ts
playwrightAdapter({
  driver,
  operationObservers: [axe],
  ...
});
```

## Narrow Playwright observations

Replace:

```ts
context: PlaywrightDriverExecutionContext
```

inside `PlaywrightOperationObservation` with a read-only execution descriptor:

```ts
export interface PlaywrightObservationExecution {
  runId: string;
  executionId: string;
  profileId: string;
  plan: JourneyPlan;
}
```

The observation may still include:

* operation;
* page;
* locator;
* expected match count;
* decision;
* stage.

It must not include:

* browser;
* context creation capability;
* evidence recorder;
* observer arrays.

## Axe object

The Axe object may continue to implement:

```ts
PlaywrightOperationObserver
JourneyReporter
```

The example will register it in both explicit roles:

```ts
const axe = axeObserver(...);

const adapter = playwrightAdapter({
  driver,
  operationObservers: [axe]
});

await runJourney({
  plan,
  adapter,
  profiles,
  reporters: [axe]
});
```

Axe no longer needs to be a generic runner observer merely to initialize execution items. The Playwright observer interface should gain an execution-start hook carrying the plan and execution descriptor.

Split the Axe package without rewriting report behavior:

```text
journey-observer-axe/src/
  index.ts
  contracts.ts
  axe-observer.ts
  axe-audit-runner.ts
  path-report-builder.ts
  report-attachments.ts
  html-report.ts
  screenshots.ts
  evidence-collection.ts
```

---

# 12. Example refactoring

Update `examples/nextcloud-filesharing/run.ts` last.

Target composition:

```ts
const plan =
  await compileUjgJourneyPlan(journey);

const axe = axeObserver({
  testInfo,
  reportId: "...",
  ...
});

const adapter = playwrightAdapter({
  driver: nextcloudDriver(
    nextcloudEnvironment
  ),
  browser: browser as Browser,
  operationObservers: [axe],
  artifacts: ...
});

const result = await runJourney({
  plan,
  adapter,
  profiles: [
    defaultProfile(),
    keyboardOnlyProfile()
  ],
  reporters: [axe]
});
```

Also remove manual construction of the entire `RunResult` for preflight failure.

Provide one runner utility:

```ts
createFailedRunResult({
  plan,
  failures,
  runId
});
```

or introduce a typed preflight hook. Do not make the example duplicate the result schema.

The example must continue to:

* attach `ujg-evidence.json`;
* print the summary;
* expose the same environment controls;
* run through the existing Playwright Test command.

---

# 13. File-by-file implementation phases

## Phase 0 — Characterization and architecture guardrails

Before modifying public APIs:

1. Add golden tests for current evidence event sequence and payloads.
2. Add tests for:

   * successful execution;
   * operation failure;
   * adapter setup failure;
   * teardown failure;
   * observer failure;
   * reporter failure;
   * artifact retention.
3. Record intentional current quirks separately.
4. Add an ADR documenting:

   * execution sessions;
   * write-only evidence channels;
   * semantic projectors;
   * explicit outcomes;
   * package dependency direction.

No production behavior changes in this phase.

## Phase 1 — Extract `journey-core`

1. Create `packages/journey-core`.
2. Move plan, locator, modality, effect, artifact, JSON, and component types.
3. Update `journey-model-ujg` to import from core.
4. Update evidence and runner imports.
5. Keep temporary re-exports from runner and evidence only where needed.
6. Update project references and root build script.

Acceptance:

```text
journey-model-ujg → journey-core
journey-evidence → journey-core
journey-runner → journey-core + journey-evidence
```

## Phase 2 — Introduce evidence sinks and semantic projectors

1. Split `EvidenceSink` from `EvidenceLog`.
2. Add run- and execution-scoped write-only channels.
3. Add centralized UJG reference projection.
4. Add `RunnerEvidence`.
5. Add `PlaywrightEvidence`.
6. Add `NextcloudEvidence`.
7. Move all raw event object construction into those files.
8. Preserve event names and payloads.

The old adapter API may remain temporarily during this phase.

## Phase 3 — Refactor the runner around execution objects

1. Add the new adapter execution-session contracts.
2. Implement `JourneyRun`.
3. Implement `ProfileExecution`.
4. Implement `OperationExecutor`.
5. Implement `EntryTracker`.
6. Implement `ObserverDispatcher`.
7. Implement `ReporterPipeline`.
8. Implement structured failure accumulation.
9. Add `operation.failed`.
10. Remove evidence and observer arrays from general-purpose helper arguments.

## Phase 4 — Convert the Playwright adapter

1. Create `PlaywrightExecution`.
2. Remove the adapter execution map.
3. Convert browser lifecycle to instance state.
4. Extract `ArtifactManager`.
5. Pass explicit outcome into `close`.
6. Remove `shouldRetainArtifacts(context, ...)`.
7. Delete `LocatorResolutionOptions`.
8. Move observer dispatch into an explicit Playwright observer dispatcher.
9. Ensure only `playwright-evidence.ts` constructs Playwright events.

## Phase 5 — Convert the Playwright driver and Nextcloud driver

1. Introduce the Playwright driver execution-session contract.
2. Create `NextcloudExecution`.
3. Remove the Nextcloud execution map.
4. Convert actor-session creation to instance behavior.
5. Bind handler context once.
6. Ensure only `nextcloud-evidence.ts` constructs Nextcloud events.
7. Preserve existing Nextcloud configuration and helper APIs.

## Phase 6 — Decouple observers and reporters

1. Remove observers from adapter contexts.
2. Add explicit `operationObservers` to Playwright options.
3. Narrow Playwright observation inputs.
4. Update Axe to use Playwright execution hooks.
5. Make reporter input immutable and consistent.
6. Collect all reporter and observer failures.
7. Split the Axe package into focused files.

## Phase 7 — Update example, tests, and documentation

1. Update the Nextcloud example composition.
2. Add the failed-result/preflight utility.
3. Split `tests/run-tests.ts` by package while retaining the existing test command.
4. Update README architecture and extension examples.
5. Remove compatibility re-exports and deprecated context APIs.
6. Run all workspace checks.

---

# 14. Test organization

Keep the current test command initially, but split test sources:

```text
tests/
  run-tests.ts
  core/
    plan-types.tests.ts
  evidence/
    recorder.tests.ts
    projections.tests.ts
  runner/
    execution.tests.ts
    failures.tests.ts
    observers.tests.ts
    reporters.tests.ts
  adapter-playwright/
    execution.tests.ts
    locators.tests.ts
    artifacts.tests.ts
    observers.tests.ts
  driver-nextcloud/
    execution.tests.ts
    sessions.tests.ts
  observer-axe/
    audit.tests.ts
    path-report.tests.ts
  model-ujg/
    compiler.tests.ts
```

`tests/run-tests.ts` should only aggregate suites and print results.

Add architecture tests that scan source files.

---

# 15. Required acceptance criteria

The refactor is complete only when all of the following are true.

## Evidence boundaries

```bash
grep -R "evidence.emit" packages
```

May match only:

```text
journey-evidence recorder/scope implementation
*/evidence/*-evidence.ts
```

It must not match:

```text
runner orchestration
operation executors
Playwright execution
artifact manager
Nextcloud execution
observer dispatch
Axe audit behavior
```

```bash
grep -R "evidence.snapshot" packages
```

May match only the runner result assembly and evidence implementation.

## Execution state

There must be no adapter or driver execution map keyed by `executionId`.

```bash
grep -R "new Map<string,.*Execution" \
  packages/journey-adapter-playwright \
  packages/journey-driver-nextcloud
```

must return no execution registries.

Actor-session and entry-tracking maps inside a single execution object are allowed.

## Context passing

After execution creation:

* adapter methods receive no `AdapterExecutionContext`;
* driver methods receive no `PlaywrightDriverExecutionContext`;
* locator helpers receive no execution context;
* observers receive no recorder.

## Unsafe construction

This must not exist:

```bash
grep -R "undefined as unknown as" packages
```

## Failure preservation

Tests must prove that operation, teardown, observer, and reporter failures are not overwritten.

## Artifact retention

`retain-on-failure` must use explicit `ExecutionOutcome`, not evidence inspection.

## Event schema

Existing event names and payload fields remain stable unless an intentional schema change is documented.

Every started operation has one terminal operation event.

## End-to-end behavior

These commands must pass:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

The existing example command must remain valid:

```bash
pnpm --filter \
  @openuji/example-nextcloud-filesharing \
  e2e
```

The example must still produce:

```text
ujg-evidence.json
Axe path JSON/HTML
configured Playwright artifacts
```

---

# 16. Explicit non-goals

Do not combine this work with:

* changing UJG compilation algorithms;
* changing Nextcloud API behavior;
* replacing Playwright;
* changing Axe scan semantics;
* parallelizing profile execution;
* replacing the test framework;
* introducing a dependency-injection container;
* designing a generic event-sourcing platform;
* migrating to OpenTelemetry;
* renaming every existing event.

These can be separate follow-up changes.

---

# 17. Instructions for the implementing agent

1. Work on `feature/migration` or a branch based on it.
2. Read the Nextcloud example first and preserve it as the acceptance scenario.
3. Commit after every phase.
4. Keep each commit buildable and type-safe.
5. Add characterization tests before moving behavior.
6. Prefer mechanical moves before semantic changes.
7. Do not add generic helper APIs that require callers to provide evidence metadata.
8. Do not expose `EvidenceRecorder` outside runner composition.
9. Do not read evidence to determine application state.
10. Pass rich domain objects into semantic evidence projectors.
11. Preserve every failure in structured results.
12. Do not modify UJG, Nextcloud, or Axe algorithms unless compilation requires a mechanical adaptation.
13. Finish by removing all compatibility APIs and verifying the acceptance grep commands.
14. In the final PR description, include:

    * old and new dependency graphs;
    * old and new adapter APIs;
    * event compatibility statement;
    * failure-model changes;
    * commands executed;
    * remaining follow-up work.

Recommended commit sequence:

```text
refactor(core): extract journey domain contracts

refactor(evidence): add scoped write-only evidence channels

refactor(runner): introduce run and execution objects

refactor(runner): replace adapter context calls with execution sessions

refactor(playwright): bind adapter and artifact state to execution

refactor(nextcloud): bind driver and actor state to execution

refactor(observers): decouple Playwright observers from runner context

refactor(results): preserve structured execution and reporting failures

test: split suites and add architecture constraints

docs: document execution sessions and evidence boundaries
