# Architecture: execution, run record, reporting, rendering

Journey Mesh keeps running journeys and reporting on them apart. They meet at
one boundary: the **run record** on disk.

```mermaid
flowchart LR
  subgraph execution["Execution — packages"]
    direction TB
    core["core, execution-model, runner"]
    plugin["plugin SDK"]
    caps["adapters, drivers, profiles,<br/>environments, services, models"]
    observers["observers (capture only)"]
    host["host"]
  end
  record[("Run record<br/>journey-run-record")]
  subgraph reporting["Reporting — packages"]
    direction TB
    reporter["journey-reporter<br/>config, report model, compare, export"]
    interpreters["journey-report-axe<br/>journey-report-android<br/>journey-report-operability"]
  end
  subgraph rendering["Rendering — apps"]
    renderer["apps/report-renderer<br/>viewer, static site, Markdown"]
  end
  host -->|writes| record
  record -->|read by| reporter
  interpreters --> reporter
  reporter -->|report model| renderer
  cli["journey-cli<br/>(composition root)"] -.-> host
  cli -.-> reporter
```

| Layer | Packages | Knows about |
| --- | --- | --- |
| Execution | `journey-core`, `journey-execution-model`, `journey-runner`, `journey-plugin`, `journey-run-record`, adapters, drivers, observers, environments, services, profiles, `journey-model-ujg`, `journey-host` | Plans, executions, evidence. Never reports. |
| Reporting | `journey-reporter`, `journey-report-*` | Run records and evidence formats. Never runtimes. |
| Rendering | `apps/report-renderer`, your templates | The report model. Never run records. How to present or publish it, including hosting limits. |
| Composition | `journey-cli`, `apps/*`, `examples/*` | Both sides; they wire them together. |

## Rules

`pnpm lint` (`scripts/lint.mjs`) enforces them on every `package.json` and import:

1. **Execution packages never depend on, or import, a reporting package**, not
   even in dev dependencies or tests.
2. **Reporting packages never depend on the host, the CLI, adapters, drivers,
   environments, services, or observer capture code.** From an observer they
   import only its `./evidence` entry: the recorded evidence types and pure
   helpers.
3. **Only composition roots depend on both sides**: `journey-cli`, `apps/*` and
   `examples/*`.
4. **Nothing under `packages/` renders**: no `.tsx`, no React, no HTML.
5. **An observer's `./evidence` entry loads no browser or device runtime**
   (Playwright, axe-core, Appium, adapters, drivers) at runtime.

## What each side owns

**Execution** decides the verdict. A test passes when its execution passed,
every journey observer output was valid, and no journey observer reported a policy error (for
example axe strict mode). The host writes the run record atomically; it has no
file-size policy, no reporters, and no journey-map validation. Observers return
only `{ id, kind, measurements, evidence, errors }`; the host keeps nothing else.

**Reporting** derives. Interpreters turn an observer's recorded evidence into
documents and per-step metrics; the reporter joins everything into the report
model. A failing interpreter or a broken journey map is a report error. It is
reported and never changes a verdict. `journey-mesh test` exits with code 3 when
the tests passed but the report could not be built at all.

**Rendering** reads the report model and evidence files, and is entirely the
app's business: formats, sites, hosting limits. The viewer, static site
publication and a Markdown summary live in `apps/report-renderer`; any other
stack can read the same JSON (see [report model](report-model.md)).

## Extending

| You want to | Write | Where |
| --- | --- | --- |
| Capture new evidence | an observer plugin (`defineExecutorObserverPlugin`) with a types-only `./evidence` entry | execution |
| Capture infrastructure diagnostics | a runtime observer plugin (`defineRuntimeObserverPlugin`) subscribing to typed lifecycle topics | execution |
| Turn that evidence into report data | an interpreter module exporting `journeyMeshInterpreter` (`defineInterpreter`) | reporting |
| Show it | a view keyed by the data's `format` in `apps/report-renderer/src/providers`, or your own template | rendering |

## Configuration and resource ownership

Preparation holds immutable configuration, compiled plans and plugin recipes.
Parsing and operation validation are pure; they see neither runtime input values
nor an artifact writer. The host resolves service-output references into deeply
frozen constructor records for adapters and services. Drivers and observers do not
share an input accessor. Runtime instances and evidence stores belong to one run.

Infrastructure effects start at `JourneyService.start`, which returns outputs,
a provenance snapshot and a release handle. Producers compensate partial failure;
the host registers returned handles before checking output contracts. Resource
owners distinguish acquisitions from borrowed resources. Explicit CLI shutdown
uses persisted ownership separately from automatic release. Android build and
installation evidence stay in the Android packages; the host and reporting layers
contain no Android-specific branches. See [service composition](service-composition.md).

## Runtime observation

Infrastructure diagnostics use a run-scoped observable, separate from journey
assessment observers. Producers publish typed topic values with a component
source and timestamp. Subscribers receive detached, immutable snapshots. Delivery
is awaited and bounded so a resource owner can publish `before-release` before
its data disappears. The bound belongs to the owner: a subscriber's `timeoutMs`
is capped by the suite's `runtimeObserverTimeoutMs` (default 30 seconds), so no
observer can hold back disposal longer than the suite allows. Subscriber errors
and timeouts cannot prevent disposal or change a journey verdict; the host
records them in `diagnostics/errors.json`.

Suite `runtimeObservers` select `defineRuntimeObserverPlugin` implementations.
Preflight parses their settings without constructing them. The host constructs
fresh subscribers and evidence stores before services start, closes them after
service cleanup, and includes their registered artifacts in the run record. No
observable, subscription, or runtime publisher is shared across runs or passed
to configuration parsers. The observable is a host implementation, not part of
the plugin SDK. Every runtime plugin context carries one publisher port,
`context.observations`; it publishes to no one outside a suite run, such as
`services up`. Runtime observers receive a frozen, subscribe-only source; no
plugin receives the subscriber registry, the publisher factory, or `close`.

Provider contracts belong to the relevant infrastructure boundary:
`journey-service-docker/observations` defines Compose lifecycle data without
collectors or application knowledge. The Nextcloud stack publishes that data
at its ownership boundaries; it does not choose or read diagnostic logs.
`journey-observer-docker` consumes the same events from any Compose producer and
captures configured container output and files. The example's `mesh.yaml`
chooses the Nextcloud log path. The host knows neither Docker nor Nextcloud,
and runtime connection metadata is never copied into provenance or the run record.
