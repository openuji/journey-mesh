Create a new repository named `journey-runner`.

Use `openuji/UJG-FedA11y` branch `feature/axe-integration` only as a read-only migration source. Do not modify the source repository and do not migrate `apps/web`.

The final repository must provide a model-driven Journey Runner whose execution is controlled primarily by the supplied UJG journey document.

## Required public example

The Nextcloud federated file-sharing example must expose a single entry point with this intended API:

```ts
import { runJourney } from "@openuji/journey-runner";
import { playwrightAdapter } from "@openuji/journey-adapter-playwright";
import { nextcloudDriver } from "@openuji/journey-driver-nextcloud";
import { axeObserver } from "@openuji/journey-observer-axe";
import {
  defaultProfile,
  keyboardOnlyProfile,
} from "@openuji/journey-profiles";
import { staticReporter } from "@openuji/journey-reporter-static";

const result = await runJourney({
  journey: new URL("./journey.ujg.jsonld", import.meta.url),

  adapter: playwrightAdapter({
    driver: nextcloudDriver({
      environment: new URL("./environment.ts", import.meta.url),
    }),
  }),

  profiles: [
    defaultProfile(),
    keyboardOnlyProfile(),
  ],

  observers: [
    axeObserver(),
  ],

  reporters: [
    staticReporter({
      outputDirectory: new URL("./evidence/", import.meta.url),
    }),
  ],
});

process.exitCode = result.ok ? 0 : 1;
```

Small API adjustments are acceptable only when they improve type safety or URL handling. Preserve the overall declarative composition.

## Primary design principle

The supplied UJG model is the source of journey execution intent.

Do not rewrite the UJG states, transitions, surfaces, locators, observation bindings, effects, and modality requirements as procedural Nextcloud test code.

The runner must derive execution from the model wherever possible.

The supplied document defines:

* Users.
* Touchpoints.
* Artifacts.
* Effects.
* Journey entries.
* Nested composite states.
* Subjourneys.
* States.
* Transitions.
* Surfaces.
* Accessible locators.
* Context locator relationships.
* Messages and accessible names.
* Accessible features.
* Surface-instance resolvers.
* Observation events.
* Observation bindings.
* Expected match counts.
* Allowed input modalities.
* Phases and steps.

Preserve all UJG identifiers in runtime evidence.

## Runtime interpretation

Implement the runtime so that it can:

1. Load canonical UJG JSON-LD.
2. Normalize it into an internal execution plan.
3. Resolve top-level and nested journey entries.
4. Enter composite states and nested subjourneys.
5. Traverse transitions.
6. Resolve the surface associated with a state or transition.
7. Find the relevant observation binding by `observeSurfaceRef`.
8. Resolve its observation event.
9. Resolve its locator references.
10. Resolve localized accessible names.
11. Resolve nested context locators.
12. Resolve runtime accessible-feature values.
13. Select an acceptable input modality according to the active execution profile.
14. Perform the interaction through the adapter.
15. Verify the destination state through its observation binding.
16. Record effects, produced artifacts, and consumed artifacts.
17. Handle subjourney exits and parent transitions.
18. Emit normalized evidence for each operation.

## Package responsibilities

Create these packages:

```text
packages/
  journey-runner/
  journey-model-ujg/
  journey-adapter-playwright/
  journey-driver-nextcloud/
  journey-observer-axe/
  journey-profiles/
  journey-evidence/
  journey-reporter-static/
```

### `journey-runner`

Own journey orchestration.

It must not contain Playwright, axe, Nextcloud, or HTML-reporting logic.

It must execute a neutral normalized journey plan and emit lifecycle evidence.

### `journey-model-ujg`

Load, validate, and normalize UJG JSON-LD.

Preserve original URNs and graph relationships.

Support nested composite states, entries, exits, transitions, surfaces, observations, effects, and artifact relationships used by the supplied journey.

Do not make the runner traverse arbitrary JSON-LD directly.

### `journey-adapter-playwright`

Translate generic journey interaction semantics into Playwright operations.

Implement generic support for:

* Role-based accessible locators.
* Accessible names.
* Context locators.
* Accessible-feature filters.
* Presence.
* Absence.
* Match counts.
* Text entry.
* Button activation.
* Option activation.
* Link activation.
* Pointer interaction.
* Keyboard Enter.
* Keyboard Space.
* Keyboard text entry.
* Screenshots.
* Browser traces.

Do not include Nextcloud labels, URLs, selectors, credentials, or workflows.

### `journey-driver-nextcloud`

Supply only Nextcloud-specific runtime context.

Responsibilities may include:

* Mapping touchpoint URNs to Nextcloud instances.
* Mapping user URNs to credentials.
* Authentication.
* Resolving entry-binding values such as `nextcloud.files` and `nextcloud.pendingShares`.
* Establishing application readiness.
* Creating and cleaning test fixtures.
* Resolving federated cloud identifiers.
* Resolving fixture-specific file identifiers.
* Waiting for Nextcloud-specific asynchronous updates.
* Providing profile-run isolation.

Do not duplicate transitions, accessible labels, observation bindings, or locators already present in the UJG document.

First migrate the working Nextcloud-specific implementation into the example. Once its actual responsibilities are clear, extract reusable Nextcloud runtime behaviour into this package.

### `journey-profiles`

Provide execution policies.

`defaultProfile()` may use normal platform interaction, preferring pointer activation where the model permits it and keyboard input for text entry.

`keyboardOnlyProfile()` must forbid pointer interaction and select keyboard-compatible modalities from those permitted by the observation event.

A profile must not define the journey or application-specific locators.

### `journey-observer-axe`

Implement axe as an optional observer.

The observer should receive browser-capable observation targets through documented runtime capabilities.

It should emit structured findings, metrics, and asset references.

It must not own journey traversal or determine whether a state was reached.

### `journey-evidence`

Define normalized evidence for:

* Runner lifecycle.
* Journey identity.
* element identity.
* Adapter activity.
* Driver activity.
* Profile decisions.
* Observer output.
* Assertions.
* Match counts.
* Effects.
* Metrics.
* Errors.
* Asset references.
* Component names and versions.

Large artifacts must be stored separately and referenced by relative paths.

### `journey-reporter-static`

Consume evidence and produce a portable static result directory.

The reporter must not control execution.

Include raw evidence alongside rendered output so additional reporters can consume it without rerunning the journey.

## Execution-profile isolation

When multiple profiles are supplied, execute the complete journey independently for each profile.

For each profile:

1. Create fresh fixture data.
2. Create isolated actor sessions.
3. Execute the complete journey.
4. Collect profile-specific evidence.
5. Clean up the test state.

Do not reuse a previously created or accepted federated share across profile executions.

Group evidence by profile.

## Example structure

Keep the final example compact:

```text
examples/nextcloud-filesharing/
  run.ts
  environment.ts
  journey.ujg.yaml
  journey.ujg.jsonld
  .env.example
  README.md
  deployment/
  sample-evidence/
```

The YAML file is the readable authoring source.

The JSON-LD file is the canonical input consumed by the runner.

Document how to regenerate JSON-LD from YAML and ensure CI verifies that the canonical document is current.

Do not create a large example-specific locator or action hierarchy unless a requirement cannot be represented by the UJG model or generic adapter.

## Evidence output

The example should produce:

```text
evidence/
  index.html
  run.json
  events.ndjson
  metrics.json
  components.json
  executions/
    default/
    keyboard-only/
  assets/
    screenshots/
    traces/
    observer-axe/
  journey/
    journey.ujg.jsonld
```

Record the versions and configuration of:

* Runner.
* UJG model loader.
* Adapter.
* Driver.
* Profiles.
* Observers.
* Reporter.
* Node.js.
* Playwright.
* Browser.
* axe.
* Tested Nextcloud instances.

## Migration procedure

Before moving files:

1. Inventory the existing branch.
2. Identify the source commit.
3. Classify each relevant file.
4. Produce a source-to-target mapping.
5. Identify which behaviour is journey-generic.
6. Identify which behaviour is Playwright-specific.
7. Identify which behaviour is Nextcloud-specific.
8. Identify which behaviour belongs to axe observation.
9. Identify obsolete web-reporting code.

Then migrate incrementally.

Do not preserve machine-specific absolute paths, credentials, generated dependencies, or obsolete architectural boundaries.

Add `MIGRATION.md` identifying the source repository, branch, and commit.

## Acceptance criteria

From a clean checkout, these commands must succeed:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

The example must run through:

```bash
pnpm example:nextcloud
pnpm example:nextcloud:headed
```

The example must:

* Consume the supplied UJG JSON-LD document.
* Execute the complete journey with the default profile.
* Execute the complete journey with the keyboard-only profile.
* Maintain separate Alice and Bob actor sessions.
* Operate against two independently configured Nextcloud instances.
* Use UJG locators and observation bindings where defined.
* Use the Nextcloud driver only for application-specific runtime context.
* Run axe as an optional observer.
* Produce static and machine-readable evidence.
* Associate every state, transition, observation, effect, and error with its UJG identifier.
* Return a non-zero process exit code when the mapped journey cannot be completed.
