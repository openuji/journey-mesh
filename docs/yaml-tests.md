# YAML journey tests

A Journey Mesh test is an ordered list of journeys assigned to adapters. The
configuration selects the models, journeys, runtime combinations, profiles,
application setup, and output. The CLI has no platform-specific execution modes.

The complete working example is
[`journey.yaml`](../examples/nextcloud-filesharing/journey.yaml). It contains both
`browser-sharing` and `native-recipient-sharing` in one file.

```sh
journey-mesh validate journey.yaml --test browser-sharing
journey-mesh test journey.yaml --test browser-sharing
journey-mesh test journey.yaml
journey-mesh report test-results
```

Without `--test`, all declared tests run sequentially, and every selected test's
prerequisites must pass preflight before any test starts. For the reference file,
this includes Android setup and `ANDROID_UDID`. Use `--test browser-sharing` to run
only its browser test. A configuration error identifies the affected test; it
does not silently skip it.

A failed test does not stop
independent tests. A failed operation stops the remaining journeys of its current
profile. A test's other profiles still get independent execution and fixture
lifecycles. Exit codes are 0 for success, 1 for execution or reporting failure,
and 2 for configuration failure.

## Configuration

`version: 1` is required. The top-level sections are:

| Setting | Meaning |
| --- | --- |
| `model` | Compiler component: `use` and optional `options` |
| `adapters` | Named adapter components, with optional `driver` and `observers` |
| `profiles` | Named interaction-profile components |
| `tests` | Named tests, each with ordered `journeys` and profile combinations |
| `envFiles` | Optional environment files, loaded in order |
| `outputDir` | Artifact root, default `./test-results` |

Each component references an installed package subpath or local module through
`use`. Its data belongs in `options`. For example:

```yaml
model:
  use: '@openuji/journey-model-ujg/plugin'

adapters:
  web:
    use: '@openuji/journey-adapter-playwright/plugin'
    options: { browser: chromium, headless: true }
    driver:
      use: '@openuji/journey-driver-nextcloud/plugin'
      options:
        # Supply touchpoints, users, entry routes, and transition values here.
        entries:
          nextcloud.files: /apps/files/

profiles:
  pointer:
    use: '@openuji/journey-profiles/plugin'
    options: { preset: default }
  touch:
    use: '@openuji/journey-profiles/plugin'
    options:
      id: touch
      modalityPreference: ['urn:openuji:input:touch-tap']
```

This illustrates component shape; use the example for a complete configuration.
Driver options retain application-specific model IDs without placing those IDs
in the generic runtime.

A test declares its selected journeys, profile combinations, optional environment
component, and `timeoutMs` (default 600000):

```yaml
tests:
  sharing:
    journeys:
      - id: alice-offers
        source: ./ujg/filesharing.ujg.jsonld
        select: urn:journey:alice-federated-sharing
        adapter: web
      - id: bob-accepts
        source: ./ujg/filesharing.android.ujg.jsonld
        select: urn:journey:bob-remote-share
        adapter: android
    profiles:
      - id: default-web-touch-android
        journeys: { alice-offers: pointer, bob-accepts: touch }
```

The `id` identifies a configured journey occurrence. It must be unique within the
test. `select` names a Journey in the source model. Its nested journeys are part
of the selection. Internal continuations remain intact; selection does not
append a continuation into an outside parent. Selection retains the compiler's
existing linear-path restrictions. It does not add general multipath traversal.

The selected plans are concatenated in YAML order into one plan. Actor and
touchpoint identities stay in the models. The configured journey item's adapter
owns its operations, even when another journey uses the same actor/touchpoint.
The same named adapter shares an execution within a profile; different named
adapters have independent executions.

Every profile combination must assign a named interaction profile to every
journey item. Presets are `default` and `keyboard-only`; custom profiles declare
an ordered `modalityPreference` list. This is input selection, not runtime
command dispatch.

## Environment and preflight

Paths resolve relative to the YAML file, including paths consumed by official
plugins. Installed packages resolve relative to that configuration's project.
YAML anchors can share options within the same file.

Strings support `${VARIABLE}` and `${VARIABLE:-default}`. Missing or empty
required variables fail validation without including their values. Only selected
components are expanded: selecting `browser-sharing` does not require an Android
UDID or APK. An explicit `env` object supplied through the programmatic API
replaces the process environment used for loading.

Environment files are loaded in order, followed by process values:

```yaml
envFiles:
  - ./deployment/.env.example
  - path: ./deployment/.env
    optional: true
  - env: NEXTCLOUD_STACK_ENV_FILE
    optional: true
```

`optional` permits a missing path or an unset file-location variable. If the
variable is set, its referenced file must exist. Environment loading never writes
into `process.env`.

All selected tests are compiled and validated before the first shared fixture
setup. This includes references, plugin versions/kinds, runtime compatibility,
selected model targets, driver mappings, and applicable profile modality choices.
`validate` performs this resource-free preflight; it may read local files,
including APK hashes, but creates no runtime sessions or report files.

An environment plugin supplies the existing `JourneyEnvironment` hooks:
setup runs once per applicable test profile; declared effects are verified after
successful transitions; teardown runs after adapter cleanup, including partial
startup and setup failures. The Nextcloud environment module contains only its
fixture/effect semantics, receiving all deployment data from YAML.

## Plugins and programmatic use

A module exports `journeyMeshPlugin` with `apiVersion: 1`, `kind`, `validate`, and
`create`. Supported kinds are `model`, `adapter`, `driver`, `observer`, `profile`,
and `environment`. Runtime-bound components declare a matching `runtime` string.
The runtime does not dispatch on specific provider names.

Import contracts and validation helpers from `@openuji/journey-runtime/plugin`.
`validate(options, context)` checks configuration. `create(options, context,
dependencies)` returns a component. Both are resource-free: allocate browser or
device resources in the resulting adapter execution's `start` or later hooks.
The context supplies resolved environment values, path resolution, the selected
operations, a test ID, and an artifact store. Adapter dependencies contain its
constructed driver and observers. An observer plugin returns
`{ observer, reporter? }`; a model plugin returns an object with
`compile(source, selection)`.

```ts
import { runConfiguredTests, validateConfiguredTests } from '@openuji/journey-runtime';

await validateConfiguredTests('./journey.yaml', { test: 'sharing' });
const suite = await runConfiguredTests('./journey.yaml', {
  test: 'sharing',
  signal: abortController.signal
});
```

The low-level `runJourney`, `touchpointAdapter`, and adapter factories remain
available. `routedAdapter(resolve)` exposes their shared operation-routing
lifecycle for other composition strategies. `compileUjgJourneyPlan` accepts an
optional `{ journeyId }` argument; existing whole-document calls are unchanged.

## Artifacts and cancellation

Each test writes into its own directory under `outputDir`. The root contains a
suite `index.html` and `journey-results.json`. Each test contains
`ujg-evidence.json`, `ujg-summary.json`, its own HTML index, and observer artifacts.
Operation evidence includes original source references plus test, journey-item,
source-document, and adapter identifiers. Reporting failure never rewrites the
immutable functional result, and still fails the command.

`JourneyArtifactStore` writes/registers/reads artifacts and provides safe output
paths. Axe accepts `artifacts` directly; existing `testInfo` callers remain
structurally compatible. Android uses the same store through its writer/reader
ports. Generic evidence, summaries, and report navigation do not need Playwright
Test.

Timeouts, SIGINT, and SIGTERM propagate an AbortSignal. Dispatch stops, owned
browser/device resources are closed, and environment teardown is attempted.
Custom setup/effect hooks must cooperate with `context.signal`; an arbitrary
promise that ignores cancellation cannot be forcibly stopped safely in-process.
Cleanup and reporting errors remain visible alongside the original failure.

This configuration contract targets the repository's existing UJG 1.0-rc1
models. Selecting another adapter does not translate platform-specific bindings.
