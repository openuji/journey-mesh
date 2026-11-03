# Automation adapters

`JourneyAdapter` is the runtime-neutral boundary exported by
`@openuji/journey-runner`. Its contracts live in
[`adapters/contracts.ts`](../packages/journey-runner/src/adapters/contracts.ts).
The runner supplies model operations, a profile, and execution identifiers.
Adapters own automation handles, application drivers, and runtime observers.

An adapter implements `createExecution({ context })`. Each applicable profile receives a new
execution with `start`, `openEntry`, `assertState`, `performTransition`,
`recordControlFlow`, and `close`. `close({ executionFailed })` must release
resources after partial startup and tolerate repeated calls.

## Model inputs and runtime commands

`InputModalityDecision` contains `profileId`, `inputModalityProfile`, and
`modality`. Modality IDs are open strings from the model. The built-in
`journeyInputModalityIds` constants are conveniences, not an exhaustive registry.
Adding an adapter or a modality does not require editing a shared command union.
The legacy `JourneyInputModalityId` and `ResolvedJourneyInputModality` aliases are
deprecated; use `string` and `ResolvedInputModality` respectively.

Adapters translate the modality IDs they support into their own commands and
reject unsupported IDs. For example, Playwright owns `PlaywrightInteractionCommand`
and `playwrightCommandForModality(...)`; profiles never select clicks or keypress
commands themselves.

When a transition declares no `requiredInputModalityProfiles`, the runner calls
`performTransition(operation, undefined)` without selecting an input modality.
The adapter must handle the automatic transition or wait for its application
condition. It must not invent a default UI action. Playwright delegates this case
to the driver's `afterTransition` without resolving or activating a locator.
The runner verifies declared effects after successful transition handling.
After the driver completes a no-input transition, Playwright emits a
`transition-completed` observation without a page or locator. Axe records it as
unaudited with an explicit reason, rather than leaving it marked as unscanned.
Axe metadata counts attempted executions in `executionCount` and records
excluded profiles separately in `notApplicableProfileCount`.

Accessible locator roles are model vocabulary identifiers. The checked-in UJG
example uses ARIA roles; the execution model does not enforce a universal role
vocabulary. Playwright resolves supported roles through `getByRole`. Native
adapters must explicitly map or reject roles, names, features, and contexts.

## Profiles across touchpoints

`inputModalityProfile({ id, modalityPreference })` selects among model-declared
modalities using an ordered list of arbitrary IDs. `defaultProfile()` and
`keyboardOnlyProfile()` retain their existing web preferences. An applicable
profile with no supported modality fails the operation.
`selectInputModality` is optional for profiles that only execute no-input
transitions. An input transition fails with an explicit error if its profile
has no selector, including when that profile is selected through `touchpointProfile`.

A profile may implement `appliesTo(operation, context)`. All profiles are assessed
across the plan before any execution hooks, environment setup, or adapter creation.
`RunResult.assessments` holds immutable applicability decisions: `applicable`,
`not-applicable` with a reason, or `failed` with an assessment error. An excluded
profile has no execution, execution lifecycle events, or operation evidence.
An applicability callback failure is reported as an assessment failure; eligible
profiles can still execute.

The `profiles-assessed` progress event and `onRunStarted.assessments` expose the
completed assessment. Pass/fail counts use actual executions only. A run with
every profile excluded returns a derived `No applicable profile executions`
diagnostic for observers and reports.

For a complete mixed journey, compose the appropriate profile for each touchpoint:

```ts
import { inputModalityProfile, keyboardOnlyProfile, touchpointProfile } from "@openuji/journey-profiles";

const mixed = touchpointProfile({
  id: "keyboard-web-touch-android",
  profiles: {
    "urn:touchpoint:nextcloud-a": keyboardOnlyProfile(),
    "urn:touchpoint:nextcloud-b": inputModalityProfile({
      id: "touch",
      modalityPreference: ["urn:example:input:tap"]
    })
  }
});
```

The tap ID above is illustrative: the model must declare the chosen modality and
the native adapter must implement it. A missing touchpoint profile makes the
composite profile inapplicable in preflight. A mapped profile's unsupported input remains
an execution failure. Decisions retain the composite execution's profile ID.

## Immutable results and reporting

Execution results describe attempted executions only:

```ts
type JourneyOutcome =
  | Readonly<{ kind: "passed" }>
  | Readonly<{ kind: "failed"; error: JourneyRunError }>;

type ExecutionResult = Readonly<{
  executionId: string;
  profileId: string;
  outcome: JourneyOutcome;
}>;
```

Operation evidence uses the same outcome union. `executionPassed(result)` derives
a boolean when a consumer needs one. Error data exists only on a failed outcome;
applicability stays in the assessment. The runner combines operation, cleanup,
and observer outcomes as immutable values rather than maintaining mutable
pass/fail flags. Cleanup composition preserves earlier failures.

The result builder derives `RunResult.ok` and `RunResult.errors` from assessments,
completed execution outcomes, and run lifecycle errors. These are immutable report
snapshots. Runner-owned outcome records, errors, assessments, evidence records,
and their arrays are frozen before publication. Input journey models remain
caller-owned inputs.

## Accessibility evidence and report projection

The axe observer collects immutable evidence facts rather than updating path
items. Its append-only journal records execution plan snapshots, observed stages,
screenshot outcomes, and audit outcomes. Runtime pages and locators stay inside
the collector. The `evidence` getter returns a frozen snapshot without changing
the journal. Reading or rendering evidence never seeds missing report items.

```text
observation -> screenshot/audit collection -> immutable facts
plan snapshots + facts -> path report + accessibility summary
```

`buildAxePathItems(evidence, runId, runnerEvidence?)` derives audited, skipped, and not-applicable
items and their reasons. Unvisited operations come from the execution's plan
snapshot. The latest observation supplies each operation's path item; all
completed scans remain available when deriving strict-mode failures. Facts are
scoped by run ID so reusing an observer does not mix reports across runs.

`buildAxeObservedPathReport` passes `result.evidence` into that projection. Runner
operation records are matched by execution ID and operation ID. An operation
without axe observations that is attributed to another adapter is not applicable
to this observer, with a reason naming that adapter. Its functional outcome is
unchanged, including failures. Missing attribution or an unreached operation
never implies a different adapter; existing projection rules still apply,
including skipped unobserved web surfaces. Actual axe observations take
precedence over adapter attribution.

Audit failures are recorded before being propagated to the runner, preserving
any screenshot evidence. Report and summary builders read these facts without
mutating them. Returned reports are frozen, detached values.

`buildAxeObservedPathReport` accepts the run result, evidence, report metadata,
tags, and an explicit `createdAt`. The lower-level `buildAxePathAuditReport` also
requires `createdAt`. The pure `buildAxeAuditReport` accepts a URL, timestamp,
strict setting, metadata, tags, and scan results; it reads no browser or clock.
The accessibility summary defaults its timestamp to the path report timestamp.
Clock reads, scans, screenshots, artifact writes, and journal appends stay at the
I/O boundaries. Latest-report getters expose the last fully published artifact
bundle.

## Routing across adapters

`runJourney({ adapter, plan, profiles })` accepts one adapter or a composition:

```ts
import { runJourney, touchpointAdapter } from "@openuji/journey-runner";

await runJourney({
  plan,
  profiles: [mixed],
  environment,
  adapter: touchpointAdapter({
    "urn:touchpoint:nextcloud-a": web,
    "urn:touchpoint:nextcloud-b": android
  })
});
```

Here `web` and `android` are adapters supplied by the caller. The runnable
Nextcloud example currently assigns one Playwright instance to both touchpoints;
Appium is not implemented yet.

The router selects by exact `operation.touchpointId` and checks every route before
shared fixture setup. One child execution is created per distinct adapter object
per profile. Children start in first-use order and close in reverse order,
including partially started children. Unused adapters allocate no resources.
Reusing an adapter object across routes shares its execution; separate objects
have separate executions even if their names match.

Each child receives the complete plan and only executes its routed operations.
Entry navigation is tracked per actor and touchpoint. The runner owns operation
order, progress, and functional evidence.

An adapter can implement the resource-free `describeOperation(operation)` method
to report the actual executing child. The runner resolves descriptions before
setup and emits a sanitized name/version descriptor in each operation's
`evidence.adapter`, including failed operations. `onRunStarted` still identifies
the top-level composition. Runtime observers stay on their child adapters;
Playwright observers receive pages/locators, and an Android observer can receive
native hierarchy evidence.

## Shared environment lifecycle

`runJourney({ environment })` accepts runtime-independent service hooks:

- `setup(context)` runs once per applicable profile, before any adapter starts.
- `verifyEffect({ context, operation, effect, decision })` runs for each declared
  effect after its transition succeeds. The decision is absent for no-input
  transitions. A verification failure fails that operation.
- `teardown({ context, executionFailed })` runs after all adapters close, even
  after partial setup, adapter creation/start failure, or effect failure.

Cleanup attempts continue after failures. Original execution and cleanup errors
are retained in the execution error message. These hooks carry no browser or
native runtime handles. The Nextcloud example now uses them for HTTP fixture
setup, cleanup, and OCS/WebDAV effect checks. Avoid registering the same shared
work in both runner hooks and legacy driver hooks.
The Nextcloud example rejects unknown effect IDs so an absent verifier cannot
silently pass a transition.

## Console imports and migration

The runner's main entry point has no Node runtime imports. Node console utilities
and their summary types are exported from a dedicated subpath:

```ts
import { runJourney } from "@openuji/journey-runner";
import { consoleJourneyProgress, renderJourneyRunSummary } from "@openuji/journey-runner/console";
```

Existing adapter factories and single-adapter calls remain valid. Callers must
replace `decision.command` with an adapter-owned mapping from `decision.modality.id`,
accept an optional decision in transition hooks, and update console imports.
Execution and operation consumers must read `outcome.kind` and narrow failed
outcomes to access `outcome.error`, replacing the old `ok`/optional-error fields.
Applicability comes from `RunResult.assessments`. The `execution-completed`
progress event carries its immutable execution `result`; excluded profiles
appear only in the earlier `profiles-assessed` event.
Legacy evidence without adapter provenance remains readable through the optional
`JourneyOperationEvidence.adapter` field.

See [Nextcloud Android migration notes](nextcloud-android.md) for driver reuse,
mobile model bindings, and the native observer work still to be implemented.
