# Journey Mesh — Architecture Refactoring Specification

**Status:** Proposed (revised after code review, 2026-11-24)\
**Scope:** Architecture, package boundaries, terminology, plugin contracts, configuration, observation, reporting integration, and migration\
**Repository:** [https://github.com/openuji/journey-mesh](https://github.com/openuji/journey-mesh)

---

## 1. Objective

Refactor Journey Mesh into a vendor-independent, multi-platform journey execution framework with explicit separation of concerns.

The target architecture distinguishes:

| Concept            | Responsibility                                                    |
| ------------------ | ----------------------------------------------------------------- |
| Runner             | Orchestrates journey execution                                    |
| Platform           | Defines platform-specific client contracts and capabilities       |
| Vendor             | Groups integrations belonging to a software ecosystem             |
| Client             | Resolves application-specific entry targets and transition values |
| Executor           | Executes journey operations using an automation technology        |
| Toolkit            | Provides reusable platform infrastructure operations              |
| Service            | Provisions and manages infrastructure                             |
| Environment        | Manages fixtures and verifies effects                             |
| Profile            | Selects applicable interaction modalities                         |
| Journey Observer   | Observes runner and execution lifecycle                           |
| Executor Observer  | Observes operations through an executor                           |
| Runtime Observer   | Observes infrastructure and resource lifecycle                    |
| Report Interpreter | Transforms recorded evidence into report data                     |

The architecture must support:

1. Multiple vendors, including Nextcloud, Moodle, and Mastodon.
2. Multiple platforms, including Web, Android, and future iOS.
3. Different executors for the same platform.
4. Cross-platform journeys within one run.
5. Multiple independent observation mechanisms.
6. Future cross-vendor journeys.
7. Independent extension of platforms, vendors, executors, and observers without modifying the runner.

**Primary objective:** Establish clear contracts, naming, and package boundaries while preserving existing execution behavior.

**Scope note:** A second vendor's Web client can already be added without runner changes: `defineDriverPlugin({ driverContract: webDriverContract })` passes the host's contract-id check. This refactoring mainly buys clear names and package boundaries. The parts that unlock new capability are the Android platform/toolkit/service separation and the Android-specific Appium observation contract (for iOS), and, optionally, shared vendor infrastructure (§17, step D) for a second vendor.

---

## 2. Architectural principles

### 2.1 Single responsibility

Every component owns one clearly defined responsibility.

Platform contracts do not execute operations.

Clients do not manage automation resources.

Executors do not implement vendor-specific application behavior.

Observers do not control journey progression.

Services do not own individual executor sessions.

Report interpreters do not perform live observation.

### 2.2 Contract-driven composition

Components interact through explicit typed contracts.

Compatibility must be checked before execution resources are allocated.

### 2.3 Vendor independence

Adding Moodle, Mastodon, or another vendor must not require changes to the runner, platform contracts, or existing executors.

### 2.4 Platform independence

Adding iOS must not require changes to existing Web or Android contracts.

### 2.5 Observation independence

Observation is an independent extension dimension.

Different observers may measure different properties of the same journey without changing execution behavior, except where explicitly configured observation policies contribute failures to the execution verdict.

### 2.6 Preserve execution semantics

The refactoring is architectural, not a rewrite of journey execution.

Existing behavior, resource ownership, cleanup, evidence, and verdict semantics must remain intact.

---

## 3. Terminology migration

Replace ambiguous terminology consistently.

| Existing                     | Proposed                                  |
| ---------------------------- | ----------------------------------------- |
| `driver`                     | `client`                                  |
| `adapter`                    | `executor`                                |
| `journey-driver-web`         | `journey-platform-web`                    |
| `journey-driver-android`     | Split into platform, toolkit, and service |
| `journey-driver-nextcloud`   | `journey-vendor-nextcloud`                |
| `journey-adapter-playwright` | `journey-executor-playwright`             |
| `journey-adapter-appium`     | `journey-executor-appium`                 |
| `DriverPlugin`               | `ClientPlugin`                            |
| `AdapterPlugin`              | `ExecutorPlugin`                          |
| `ObserverPlugin`             | `ExecutorObserverPlugin`                  |
| `RuntimeObserverPlugin`      | Keep                                      |
| `JourneyObserver`            | Keep                                      |
| `automation` (plugin property) | `observationContract`                   |
| `playwrightAutomation` (`"playwright"`) | `playwrightObservationContract` (`@openuji/playwright-observation/v1`) |
| `appiumAutomation` (`"appium"`) | `appiumAndroidObservationContract` (`@openuji/appium-android-observation/v1`) |

The terms *client*, *executor*, and *observer* must be defined explicitly in project documentation.

Names that are stored in run records are migrated as described in §10.6, not by this table alone.

### 3.1 Client

A client is a deterministic vendor-specific binding for a user-facing application on a particular platform.

It is not the actual application implementation.

For example, the Nextcloud Web client in Journey Mesh resolves how a modeled journey enters and supplies values to the Nextcloud Web application.

### 3.2 Executor

An executor performs modeled operations against the application using a particular automation technology.

For example, Playwright performs Web interactions.

### 3.3 Platform

A platform defines the common contracts connecting compatible clients and executors.

Examples: Web, Android, iOS.

### 3.4 Observer

An observer collects evidence at a particular architectural boundary.

Observation purpose and observation boundary are independent concepts.

---

## 4. Target package architecture

```
packages/
│
├── journey-core/
├── journey-execution-model/
├── journey-runner/
├── journey-host/
├── journey-plugin/
├── journey-cli/
├── journey-model-ujg/
│
├── journey-platform-web/
├── journey-platform-android/
├── journey-platform-ios/            # Future
│
├── journey-toolkit-android/
├── journey-toolkit-ios/             # Future
│
├── journey-service-android/
├── journey-service-ios/             # Future
├── journey-service-docker/
├── journey-service-git/
│
├── journey-executor-playwright/
├── journey-executor-appium/
│
├── journey-vendor-nextcloud/
│   ├── src/
│   │   ├── shared/
│   │   ├── web/
│   │   ├── android/
│   │   ├── environments/
│   │   └── services/
│   └── package.json
│
├── journey-vendor-moodle/           # Future
│   ├── src/
│   │   ├── shared/
│   │   ├── web/
│   │   ├── android/
│   │   ├── ios/
│   │   ├── environments/
│   │   └── services/
│   └── package.json
│
├── journey-profiles/
├── journey-environment-http/
│
├── journey-observer-axe/
├── journey-observer-android-accessibility/
├── journey-observer-ux/
├── journey-observer-operability/
├── journey-observer-docker/
│
├── journey-report-axe/
├── journey-report-android/
├── journey-report-operability/
├── journey-reporter/
├── journey-run-record/
│
└── ...
```

Future packages are illustrative and must not be created as empty placeholders.

Existing packages outside this refactoring remain unchanged.

Observer packages are organized primarily by observation purpose or implementation, not by vendor.

---

## 5. Platform contracts

### 5.1 Web

Rename:

`journey-driver-web` → `journey-platform-web`

The package contains:

- `WebJourneyClient`
- `WebEntryTarget`
- `webClientContract`
- Pure entry target constructors

Proposed interface:

```
export const webClientContract =
  contract<WebJourneyClient>(
    "@openuji/journey-platform-web/client/v1"
  );

export type WebJourneyClient = Readonly<{
  name: string;
  version?: string;

  resolveEntry(
    operation: JourneyPlanOperation
  ): WebEntryTarget;

  resolveTransitionValue(
    operation: TransitionPlanOperation
  ): string | undefined;
}>;
```

The Web platform must not depend on:

- Playwright
- Browser lifecycle implementations
- Nextcloud
- Moodle
- Specific observers

It defines compatibility and platform-specific data types, not automation behavior.

### 5.2 Android

Split `journey-driver-android` into three packages.

#### `journey-platform-android`

Contains pure contracts and types:

- `AndroidJourneyClient`
- `androidClientContract`
- Android application entry targets
- Android deep-link entry targets
- APK identity and output contracts
- Android device identity and output contracts

Must not depend on Android SDK tooling, Appium, filesystem APIs, or vendors.

#### `journey-toolkit-android`

Named *toolkit*, not *runtime*: *runtime* already means runtime observation (§9.4), and the current `src/runtime/` folders contain services.

Contains reusable infrastructure operations:

- Android SDK discovery
- ADB operations
- Emulator operations
- Device pool implementation
- APK build utilities
- APK inspection
- Installation verification

Must not depend on application vendors or executors.

#### `journey-service-android`

Contains infrastructure service plugins:

- Emulator pool provisioning
- Android device acquisition and release
- APK build services
- Persistent ownership records
- Service outputs
- Explicit shutdown behavior

Services may use `journey-toolkit-android`.

The service package also receives:

- The Gradle runtime-observation topic (`src/runtime/gradle-observations.ts`). It moves with the APK build service that publishes it.
- The `android check` CI command (`src/runtime/cli.ts`, today the `journey-driver-android` bin). It reads suite configuration through `journey-host`, so it cannot live in the platform or toolkit package. The bin is the only part of the service package that depends on `journey-host`.

#### Placement of current exports

| Current                                          | Target                                      |
| ------------------------------------------------ | ------------------------------------------- |
| `journey-driver-android` (root contracts)        | `journey-platform-android`                  |
| `journey-driver-android/service` (emulator pool) | `journey-service-android/emulator/service`  |
| `journey-driver-android/apk-build/service`       | `journey-service-android/apk-build/service` |
| `journey-driver-android/installation`            | `journey-toolkit-android/installation`      |
| `findSdk` (from `/service`, used by Appium)      | `journey-toolkit-android`                   |
| `journey-driver-android` bin                     | `journey-service-android` bin               |

Subpath names are proposals; what matters is which package owns each export.

### 5.3 iOS

The architecture must allow future:

- `journey-platform-ios`
- `journey-toolkit-ios`
- `journey-service-ios`

Do not implement iOS during this refactoring.

Ensure existing contracts do not assume Android-specific behavior universally applies to mobile platforms.

---

## 6. Client plugin architecture

Rename the plugin kind:

`driver` → `client`

### Public API

| Existing                | Proposed                |
| ----------------------- | ----------------------- |
| `DriverPlugin`          | `ClientPlugin`          |
| `defineDriverPlugin()`  | `defineClientPlugin()`  |
| `driverContract`        | `clientContract`        |
| `WebJourneyDriver`      | `WebJourneyClient`      |
| `AndroidJourneyDriver`  | `AndroidJourneyClient`  |
| `webDriverContract`     | `webClientContract`     |
| `androidDriverContract` | `androidClientContract` |

Proposed plugin interface:

```
export type ClientPlugin<
  S = unknown,
  C = unknown
> = Plugin<"client", S, C> & {
  readonly clientContract: Contract<C>;
};

export const defineClientPlugin =
  <S, C>(plugin: ClientPlugin<S, C>) => plugin;
```

Client requirements:

1. Implement the declared platform contract.
2. Resolve deterministic application entry targets.
3. Resolve configured transition values.
4. Validate configuration.
5. Return immutable contract values where required.
6. Avoid mutable automation session state.
7. Avoid importing executors.
8. Avoid allocating infrastructure or automation resources.

Keep separate platform client contracts. Do not replace them with a single abstraction that hides platform-specific entry target types.

---

## 7. Executor architecture

Rename `adapter` to `executor`.

### Public API

| Existing                  | Proposed                 |
| ------------------------- | ------------------------ |
| `JourneyAdapter`          | `JourneyExecutor`        |
| `JourneyAdapterExecution` | `JourneyExecutorSession` |
| `AdapterPlugin`           | `ExecutorPlugin`         |
| `AdapterDependencies`     | `ExecutorDependencies`   |
| `defineAdapterPlugin()`   | `defineExecutorPlugin()` |
| `driver`                  | `client`                 |
| `driverContract`          | `clientContract`         |
| `automation`              | `observationContract`    |
| `routedAdapter()`         | `routedExecutor()`       |
| `touchpointAdapter()`     | `touchpointExecutor()`   |

The executor:

- Opens application entry targets.
- Executes transition operations.
- Asserts expected states.
- Compiles supported model observation bindings into executable queries.
- Manages automation resources and sessions.
- Exposes execution observations to compatible executor observers.
- Declares the observation contract its executor observers must implement (§9.3) and publishes it through a pure `./observation` entry point (§9.9).
- Releases execution-owned resources.

### 7.1 Playwright

Rename:

`journey-adapter-playwright` → `journey-executor-playwright`

The Playwright executor consumes `WebJourneyClient`.

It owns:

- Browser launching
- Browser context creation
- Page navigation
- Web locator interpretation
- Web interactions
- State assertions
- Browser execution lifecycle
- Playwright observation hooks

It must not depend on specific vendors.

### 7.2 Appium

Rename:

`journey-adapter-appium` → `journey-executor-appium`

Initially preserve its Android-specific behavior.

Update dependencies to use:

- `journey-platform-android` for contracts.
- `journey-toolkit-android` for installation verification and related utilities.

The Appium server service (`journey-adapter-appium/service`, configured as `services.appium`) stays in this package as `journey-executor-appium/service`. An Appium server is not Android-specific, so it does not belong in `journey-service-android`.

The current Appium implementation contains Android-specific assumptions. This includes its observation contract: `AppiumExecutionObserver` and `AppiumSession` expose `AndroidDeviceMetrics`, `deviceMetrics()` and `openDeepLink(url, applicationId)`. Its compatibility identifier must therefore name Android: `@openuji/appium-android-observation/v1`, not `"appium"`. Otherwise a future Appium iOS executor declaring `"appium"` would accept the Android accessibility observer.

Future iOS support should separate shared Appium functionality from Android-specific and iOS-specific executor plugins.

### 7.3 Runner versus executor

**Runner:** Determines what and when to execute.

**Executor:** Determines how an operation is performed.

Preserve the distinction between overall journey execution and individual executor session lifecycles.

---

## 8. Vendor architecture

Rename:

`journey-driver-nextcloud` → `journey-vendor-nextcloud`

A vendor is a grouping and distribution boundary, not an alternative execution contract.

### Vendor responsibilities

A vendor may supply:

- Platform-specific clients
- Shared application configuration resolution
- Application-specific environments
- Application deployment services
- Application build services
- Integration tests
- Optional metadata

A vendor must not implement generic browser or mobile automation.

### 8.1 Nextcloud

Proposed internal structure:

```
journey-vendor-nextcloud/
├── src/
│   ├── shared/
│   │   ├── resolver.ts
│   │   └── plugin-options.ts
│   ├── web/
│   │   ├── client.ts
│   │   └── plugin.ts
│   ├── android/
│   │   ├── client.ts
│   │   └── plugin.ts
│   ├── environments/
│   │   └── federated-sharing/
│   └── services/
│       ├── stack/
│       ├── stack-built/
│       ├── server-build/
│       ├── app-build/
│       └── app-install/
└── package.json
```

Preserve:

- Nextcloud Web and Android entry resolution
- Existing transition values
- OCS/WebDAV fixtures
- Federated sharing checks
- Application deployment and build behavior

### 8.2 Moodle extension verification

A second vendor must be implementable without modifying the runner or existing executors.

Example:

```
export const journeyMeshPlugin =
  defineClientPlugin({
    kind: "client",
    clientContract: webClientContract,

    parse(options, context) {
      return parseMoodleWebOptions(
        options,
        context.operations
      );
    },

    create(settings) {
      return moodleWebClient(settings);
    }
  });
```

Moodle-specific course creation, enrollment fixtures, and effect verification belong to Moodle environments and services.

A complete Moodle implementation is outside the refactoring scope.

The client is the easy part of a second vendor. Most of the cost sits in code that is generic but currently lives in the Nextcloud package:

- `resolver.ts` binds operations to entries, touchpoints and users, and resolves transition values. Apart from its error messages it contains nothing Nextcloud-specific; a Moodle client would copy it.
- `runtime/stack.ts` mixes generic Compose lifecycle (ownership records, fresh-project checks, `up`/`down`, `composeLifecycle` publication, release) with Nextcloud bootstrap through `occ`.

Extracting both is optional step D in §17.

---

## 9. Observation architecture

Observation must become an explicitly documented architectural dimension.

The existing implementation contains three distinct observation boundaries:

1. Journey lifecycle observation.
2. Executor operation observation.
3. Runtime infrastructure observation.

These boundaries have different contracts, capabilities, and dependencies.

**Do not collapse them into one universal observer interface.**

### 9.1 Journey observers

Current runner interface: `JourneyObserver`

Retain this name.

Journey observers receive runner lifecycle information.

Existing lifecycle hooks include:

```
export type JourneyObserver = {
  name: string;
  version?: string;

  onRunStarted?(input: unknown):
    Promise<void> | void;

  onRunCompleted?(input: unknown):
    Promise<void> | void;

  onExecutionStarted?(input: unknown):
    Promise<void> | void;

  onExecutionCompleted?(input: unknown):
    Promise<void> | void;
};
```

The example uses simplified input types; the existing concrete input contracts must be preserved.

Responsibilities:

- Observe run start and completion.
- Observe profile execution start and completion.
- Inspect lifecycle descriptors and results.
- Collect lifecycle-related information.

Journey observers must not:

- Control journey progression.
- Resolve vendor-specific entry targets.
- Own browser or device sessions.
- Depend on a specific vendor.

The existing runner lifecycle observer interface is distinct from the executor-attached observer plugin mechanism.

Do not introduce a mandatory new runner-observer plugin kind solely for naming symmetry.

### 9.2 Executor observers

Rename the existing executor-attached `ObserverPlugin` terminology to `ExecutorObserverPlugin`.

Proposed public API:

| Existing                      | Proposed                            |
| ----------------------------- | ----------------------------------- |
| `ObserverPlugin`              | `ExecutorObserverPlugin`            |
| `defineObserverPlugin()`      | `defineExecutorObserverPlugin()`    |
| `PlaywrightExecutionObserver` | Keep                                |
| `AppiumExecutionObserver`     | Keep                                |
| `JourneyObserverComponent`    | Keep as the observer/output wrapper |

For maximum terminology consistency, the target plugin kind should become:

`"observer"` → `"executor-observer"`

This plugin-kind rename is part of the coordinated breaking migration. The configuration key nested under an executor may remain `observers:`.

An executor observer integrates with an executor's observation boundary.

Examples:

- Axe accessibility observation through Playwright.
- Android accessibility observation through Appium.
- UX observation through Playwright.

Executor observers may receive:

- Execution lifecycle information.
- Modeled operation identities.
- Observed state and transition stages.
- Executor-specific locator or element references.
- Input modality decisions.
- Evidence capture opportunities.

They must not own the executor session lifecycle.

They must not initiate unrelated journey interactions.

### 9.3 Executor observer compatibility

An executor observer must declare the automation contract it supports.

The existing compatibility mechanism must be retained.

For example:

```
export const journeyMeshPlugin =
  defineExecutorObserverPlugin({
    kind: "executor-observer",
    observationContract: playwrightObservationContract,

    parse(options) {
      return parseAxeOptions(options);
    },

    create(settings, context) {
      const observer = axeObserver({
        ...settings,
        artifacts: context.artifacts
      });

      return {
        observer,
        output: ({ result }) =>
          observer.output(result)
      };
    }
  });
```

This is target API syntax, not current repository syntax.

The observation contract identifies observer/executor compatibility. Both sides declare it: the executor plugin declares the contract it publishes, and each executor observer plugin declares the contract it implements. The host compares their identifiers before allocating resources (today `compatible()` in `journey-host/src/assemble.ts` compares the `automation` property of both plugins).

Observation contract identifiers are namespaced and versioned, like client contracts: `@openuji/playwright-observation/v1` and `@openuji/appium-android-observation/v1` replace `"playwright"` and `"appium"`.

**Platform compatibility and observer compatibility are separate checks.**

For example:

- A Nextcloud Web client must match the Web client contract.
- The Playwright executor must accept that Web client contract.
- An Axe observer must match the Playwright observation contract.

An observer that supports Playwright must not automatically be considered compatible with every Web executor.

### 9.4 Runtime observers

Retain:

- `RuntimeObserver`
- `RuntimeObserverPlugin`
- `defineRuntimeObserverPlugin()`
- Plugin kind `"runtime-observer"`

Runtime observers capture infrastructure evidence independently from journey assessment and executor operation observation.

The current runtime observation interface uses typed topics and a subscription mechanism.

Its responsibilities include:

- Subscribing to runtime events.
- Observing resource lifecycle information.
- Capturing relevant infrastructure diagnostics.
- Writing evidence artifacts when appropriate.
- Unsubscribing and cleaning up its own observation resources.

Example implementation:

`journey-observer-docker`

The Docker runtime observer can collect container logs and diagnostic files associated with Compose resource lifecycle events.

Runtime observers do not require a Playwright or Appium session.

### 9.5 Runtime observation contracts

Preserve the existing typed runtime observation mechanism:

```
export type RuntimeObservation<T> =
  Readonly<{
    topic: string;
    source: string;
    timestamp: string;
    value: Immutable<T>;
  }>;
```

The existing architecture provides an `ObservationPublisher` and a read-only subscription interface for runtime observers.

Preserve these semantics:

- Publishers publish typed events.
- Runtime observers subscribe to events.
- The host controls observation delivery.
- Delivery has bounded timeouts.
- Resource cleanup remains deterministic.
- Runtime observers cannot close the host's observation channel.

Runtime observers must not become general-purpose execution controllers.

### 9.6 Observation boundaries versus categories

Observation boundary answers:

**Where is evidence collected?**

Observation category answers:

**What is measured?**

These are independent dimensions.

| Category                  | Possible observation boundary                 |
| ------------------------- | --------------------------------------------- |
| Accessibility             | Executor                                      |
| Interaction metrics       | Executor                                      |
| UX checkpoints            | Executor                                      |
| Performance               | Executor or runtime, depending on measurement |
| Reliability diagnostics   | Runtime                                       |
| Infrastructure logs       | Runtime                                       |
| Run lifecycle information | Journey                                       |

A measurement category must not be hardcoded into one platform.

For example, accessibility may be observed through Playwright, Android Appium, or future iOS automation.

Each implementation may have different capabilities and evidence formats.

### 9.7 Observer package organization

Retain purpose-specific observer packages.

Examples:

```
journey-observer-axe/
journey-observer-android-accessibility/
journey-observer-ux/
journey-observer-docker/
```

Do not move Axe into `journey-platform-web`.

Do not move Android accessibility observation into `journey-platform-android`.

Observers may legitimately depend on executor-specific observation contracts.

Platform packages must not depend on observers.

### 9.8 Observation and verdicts

Preserve the current distinction between evidence collection and execution policy.

Some observers may operate in strict mode and contribute failures to a test verdict.

For example, accessibility violations may fail execution when strict policy is enabled.

Other observers may collect evidence without changing the verdict.

The refactoring must preserve the existing mechanisms for:

- Observer errors.
- Strict observation policies.
- Observer output.
- Verdict contribution.
- Evidence collection failure handling.

Do not silently change which observation failures affect test outcomes.

### 9.9 Observation contract ownership

**The component that produces an observation owns its observation contract. The observer that records evidence owns its evidence schema. Journey Mesh core owns only the generic mechanisms that connect them.**

| Contract                                                        | Owner                                     | Consumer                            |
| --------------------------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| `JourneyObserver`                                               | `journey-runner`                          | Journey lifecycle observers         |
| `ExecutorObserverPlugin`, `RuntimeObserverPlugin`               | `journey-plugin`                          | Observer implementations            |
| `PlaywrightExecutionObserver`, `playwrightObservationContract`  | `journey-executor-playwright/observation` | Axe, UX and operability observers   |
| `AppiumExecutionObserver`, `appiumAndroidObservationContract`   | `journey-executor-appium/observation`     | Android accessibility observer      |
| Runtime observation topic                                       | Contract package on the producer side     | Runtime observers                   |
| Observer evidence schema                                        | The observer's `./evidence` entry         | Run records and report interpreters |
| Report interpreter contract                                     | `journey-reporter/interpreter`            | Interpreter implementations         |

Normative rules:

1. **The runner owns journey lifecycle contracts.** `JourneyObserver` stays in `journey-runner`.
2. **Executors own executor-specific observation contracts:** event types, stages, the capabilities passed to observers, and the compatibility identifier.
3. **`journey-plugin` owns generic observer registration** (`ExecutorObserverPlugin`, `RuntimeObserverPlugin`, their lifecycle and compatibility declarations). It defines no Playwright-, Appium- or Docker-specific payload.
4. **Runtime topics live in a contract package on the producer side, never in the observer package.** Several producers may share one topic package. `composeLifecycle` lives in `journey-service-docker/observations` and is published by the Nextcloud stack service today; any other Compose-based vendor stack can publish it, and `journey-observer-docker` works unchanged. The host owns delivery mechanics (bounded delivery, source attribution). A runtime observer must not redefine a topic.
5. **Observers own and version their evidence schemas.** Report interpreters consume them only through the observer's `./evidence` entry, never through the live automation implementation.
6. **Observation does not control execution** (§9.10).

#### Pure observation entry points

Each executor exports its observation contract through a `./observation` subpath. That entry contains only types, the `contract()` constant, and pure helpers observers need (for example `toPlaywrightObservationLocator`, used by the UX observer). Observers import executors only through that entry.

Today every observer imports `playwrightAutomation` or `appiumAutomation` from the executor's root entry. The Playwright root imports `chromium` from `playwright`, so every observer loads the executor's implementation. The `./observation` entry follows the same pattern as the existing `./evidence` entry and is enforced the same way (§14.6).

#### Dependency direction

```
journey-runner
    └── JourneyObserver contract

journey-plugin
    ├── ExecutorObserverPlugin
    └── RuntimeObserverPlugin

journey-executor-playwright/observation
    └── Playwright observation contract
           ▲
           │
    journey-observer-axe
           │
           └── Axe evidence contract (./evidence)
                    ▲
                    │
             journey-report-axe

journey-service-docker/observations
    └── Compose lifecycle topic
           ▲                         ▲
           │ publishes               │ subscribes
  vendor stack services     journey-observer-docker
```

**An observer implements a contract provided by the boundary it observes; it does not define that boundary.** The exception is its own evidence contract, which it must own because it defines the measurements and findings it records.

### 9.10 Observation capabilities

Executor observers receive only the capabilities their purpose requires. They must not initiate modeled interactions, alter runner control flow, or own executor sessions. Explicitly configured policy findings may still fail execution through the established error mechanism (§9.8).

The current contracts give observers more than that:

- Playwright observations pass `Page` and `Locator` instances.
- Appium observations pass the full `AppiumSession`, including `tap`, `setValue`, `activateApplication`, `terminateApplication`, `clearApplication`, `openDeepLink` and `close`.

This refactoring does not narrow them; removing capabilities during the rename could break existing observers. A later hardening step first records which operations each observer uses, then introduces restricted observation views with dedicated tests, for example:

```
interface AndroidObservationView {
  source(): Promise<string>;
  screenshot(): Promise<string>;
  deviceMetrics(): Promise<AndroidDeviceMetrics>;
  findElements(
    query: string
  ): Promise<readonly AppiumElement[]>;
}
```

This is an example, not necessarily the complete interface Android accessibility observers require.

---

## 10. Observation and reporting separation

Journey Mesh currently separates live observation from offline report interpretation.

Preserve this architecture.

### 10.1 Observation

Observations are collected during execution or infrastructure lifecycle events.

They may produce:

- Structured observer outputs.
- Evidence journals.
- Screenshots.
- Accessibility audit documents.
- UX measurements.
- Runtime diagnostic artifacts.

The host persists the relevant outputs and evidence in the run record.

### 10.2 Interpretation

Report interpreters read already-recorded evidence.

They do not:

- Start browsers.
- Create Appium sessions.
- Re-execute journey operations.
- Perform new live accessibility audits.
- Modify test outcomes.

Examples:

- `journey-report-axe`
- `journey-report-android`

### 10.3 Report models

Interpreters transform evidence into structured report data.

The reporter combines:

- Journey plan data.
- Execution results.
- Observer outputs.
- Interpreted evidence.
- Relevant recorded artifacts.

The report renderer consumes the resulting report model.

### 10.4 Reporting independence

Retain the current separation:

**Execution → Evidence → Interpretation → Report Model → Rendering**

Reporting failures must not retroactively alter the execution verdict.

Observer policy failures during execution may affect the verdict through their existing mechanisms.

### 10.5 Contract stability

Preserve existing observer evidence formats and interpreter compatibility unless a versioned change is required.

Do not make report interpreters depend on live executor sessions.

### 10.6 Persisted identities and run-record compatibility

Some of the renamed names are stored in run records, and interpreters compare against them:

- `JourneyOperationEvidence.adapter` (`journey-runner`) and `JourneySegment.adapter` (`journey-run-record`) are field names in test records (format version 1).
- Each operation stores the executing component's name, for example `@openuji/journey-adapter-playwright`. `routedElsewhere()` (`journey-plugin`) compares it with constants in observers (`axeAdapterName`, `androidAdapterName`) to decide whether an unobserved operation was routed to a different executor.

Without a rule, renaming the Playwright executor would make reports on old records classify unobserved Playwright operations as "routed to another executor". Rules:

1. The run and test record format version becomes 2. Version 2 uses `executor` where version 1 used `adapter`.
2. `openRunRecord()` accepts versions 1 and 2. It normalizes version 1 in memory: it renames the fields and maps legacy component names (`@openuji/journey-adapter-playwright` → `@openuji/journey-executor-playwright`, `@openuji/journey-adapter-appium` → `@openuji/journey-executor-appium`, and the runner's routed and touchpoint names). This legacy table lives only in the run-record reader.
3. Interpreters, observers and the reporter see only version-2 shapes and new names.
4. Comparing a version-1 baseline with a version-2 run gives the same result as comparing two version-1 runs.
5. Contract identifiers are not persisted and may change freely. Observer evidence formats (evidence kinds, measurement identifiers) do not change in this refactoring.

The current reader rejects every version except 1, so the reader change is required, not optional.

---

## 11. Environment versus observation

Keep environment verification separate from observation.

An environment manages application-specific fixtures and verifies modeled effects.

For example:

- Prepare a Nextcloud file.
- Establish fixture users.
- Verify a federated share exists.
- Remove test fixtures.

These are not automatically observer responsibilities.

An executor observer may report that a user activated a sharing control.

An environment may independently verify that the corresponding share exists in Nextcloud.

Both are useful, but they represent different contracts.

**Do not merge effect verification into the observer system.**

---

## 12. Configuration migration

### 12.1 Current configuration

```
adapters:
  web:
    use: "@openuji/journey-adapter-playwright/plugin"

    driver:
      use: "@openuji/journey-driver-nextcloud/web/plugin"

    observers:
      - use: "@openuji/journey-observer-axe/plugin"
```

### 12.2 Target configuration

```
executors:
  web:
    use: "@openuji/journey-executor-playwright/plugin"

    client:
      use: "@openuji/journey-vendor-nextcloud/web/plugin"

    observers:
      - use: "@openuji/journey-observer-axe/plugin"
```

The observer is attached to the executor, not to the vendor.

### 12.3 Android example

```
services:
  android:
    use: "@openuji/journey-service-android/emulator/service"
  appium:
    use: "@openuji/journey-executor-appium/service"
    dependsOn:
      - android

executors:
  android:
    use: "@openuji/journey-executor-appium/plugin"

    client:
      use: "@openuji/journey-vendor-nextcloud/android/plugin"

    observers:
      - use: "@openuji/journey-observer-android-accessibility/plugin"
```

### 12.4 Runtime observers

Keep runtime observers at suite level.

```
runtimeObservers:
  - use: "@openuji/journey-observer-docker/plugin"
    options:
      containerLogs: true
```

Runtime observers must remain independent of the chosen executor.

### 12.5 Journey references

Rename the journey reference key `adapter:` to `executor:`.

Before:

```
journeys:
  - id: alice-shares
    source: ./filesharing.ujg.jsonld
    select: urn:journey:alice-sharing
    adapter: web
```

After:

```
journeys:
  - id: alice-shares
    source: ./filesharing.ujg.jsonld
    select: urn:journey:alice-sharing
    executor: web
```

### 12.6 Configuration changes summary

| Existing                       | Proposed            |
| ------------------------------ | ------------------- |
| `adapters:`                    | `executors:`        |
| `adapter:`                     | `executor:`         |
| `driver:`                      | `client:`           |
| Executor `observers:`          | Keep                |
| `runtimeObservers:`            | Keep                |
| Test `environment:`            | Keep                |
| Plugin kind `driver`           | `client`            |
| Plugin kind `adapter`          | `executor`          |
| Plugin kind `observer`         | `executor-observer` |
| Plugin kind `runtime-observer` | Keep                |
| Plugin property `automation`   | `observationContract` |

Update the host schema, plugin loader, assembly logic, and configuration validation accordingly.

### 12.7 No compatibility aliases

All workspace packages are private and the repository has one example configuration, so the configuration change is a hard break. The host does not accept the old keys or plugin kinds. When it finds one, it fails with an error that names the replacement (for example "`adapters:` was renamed to `executors:`").

---

## 13. Vendor manifest (deferred)

A vendor manifest for discovery tooling is deferred until such tooling exists. When it is added, it must not become a runtime execution contract:

- No mandatory `vendor` plugin kind.
- No requirement for every vendor to support every platform.
- No vendor-specific compatibility logic in the runner.
- No duplication of client/executor contract checks.
- No runtime resource allocation from manifests.

---

## 14. Dependency rules

### 14.1 Client and executor dependencies

```
Nextcloud Web Client       Moodle Web Client
         │                         │
         └────────────┬────────────┘
                      ▼
             Platform Web Contract
                      ▲
                      │
              Playwright Executor
```

Clients and executors depend on shared platform contracts, not on one another.

### 14.2 Android dependencies

```
Platform Android
       ▲
       │
Toolkit Android
       ▲
       │
Service Android
```

The Android executor may depend on both platform contracts and required toolkit utilities.

The Nextcloud Android client depends only on the relevant platform and shared integration contracts.

### 14.3 Observation dependencies

```
Playwright Executor
       ▲
       │
Axe Observer / UX Observer

Appium Executor
       ▲
       │
Android Accessibility Observer

Runtime Observation Contracts
       ▲
       │
Docker Runtime Observer
```

Arrows represent permitted dependencies for compatibility or observation APIs, not ownership of execution.

Executor-specific observers may depend on an executor's observation types and automation compatibility identifiers.

They must not become dependencies of platform contracts or vendors.

### 14.4 Reporting dependencies

Report interpreters may depend on stable observer evidence formats.

Observers must not depend on report interpreters or renderers.

The executor must not depend on report presentation components.

### 14.5 Forbidden dependencies

- Platform → Vendor
- Platform → Executor
- Platform → Observer
- Vendor client → Executor
- Runner → Concrete vendor
- Runner → Concrete platform implementation
- Runner → Concrete executor
- Executor → Concrete vendor
- Observer → Report renderer
- Report interpreter → Live automation session
- Platform → Toolkit or Service
- Vendor → Observer
- Observer → Executor implementation (observers import only the executor's `./observation` entry)

### 14.6 Enforcement

`scripts/lint.mjs` already enforces the execution/reporting layer rules. Extend it rather than adding a second mechanism, and update it in the same commit as the package renames:

- `layerOf` must classify the new prefixes (`journey-platform-`, `journey-toolkit-`, `journey-vendor-`, `journey-executor-`). It already fails on an unclassified package, so a missed prefix is visible.
- `forbiddenForReporting` and `runtimeOfDevices` match `journey-(adapter|driver)-` today. If they are not updated, they silently stop matching the renamed packages, and lint rules 2 and 5 stop protecting them.

Add rules for this architecture:

1. Platform packages depend on no toolkit, service, executor, vendor or observer package.
2. Vendor packages depend on no executor or observer package.
3. Executor packages depend on no vendor package.
4. Observer packages import an executor package only through its `./observation` entry, and that entry loads no automation runtime.
5. `journey-runner` depends on no platform, vendor or executor package.

---

## 15. Environment composition

Preserve the current environment contract and single-environment-per-test host configuration during this refactoring.

Future cross-vendor journeys may benefit from multiple environments.

That future feature should provide:

- Multiple environment components per test.
- Explicit effect ownership.
- Deterministic setup order.
- Reverse teardown order.
- Error aggregation.
- Correct cleanup after failure.

Do not introduce multi-environment composition as part of this migration.

---

## 16. Behavioral invariants

The refactoring must preserve:

### Journey execution

- Compilation semantics
- Operation ordering
- State assertions
- Transition execution
- Profile applicability
- Input modality selection
- Failure propagation

### Resource lifecycle

- Service acquisition
- Service release
- Environment setup and teardown
- Executor session creation and cleanup
- Browser context lifecycle
- Android device session lifecycle

### Observation

- Journey lifecycle hooks
- Executor observation stages
- Observer compatibility checks
- Runtime observation subscriptions
- Evidence collection
- Strict policy behavior
- Observation error propagation
- Bounded runtime observation delivery

### Reporting

- Run record compatibility
- Evidence formats
- Metric identities
- Interpreter behavior
- Report generation
- Comparison behavior
- Historical record readability
- Persisted executor identities (§10.6)

Existing reports and evidence must not silently change meaning.

---

## 17. Implementation steps

All workspace packages are private, so there are no external consumers and no deprecation aliases. Each rename is done once, not phase by phase, so the code never mixes vocabularies (for example `defineDriverPlugin({ driverContract: webClientContract })`). Every step ends with type checking, unit and integration tests, `pnpm lint` and CI passing.

### Step A — One mechanical rename

- Rename packages: `journey-driver-web` → `journey-platform-web`, `journey-driver-android` → `journey-platform-android` (split in step B), `journey-driver-nextcloud` → `journey-vendor-nextcloud`, `journey-adapter-playwright` → `journey-executor-playwright`, `journey-adapter-appium` → `journey-executor-appium`.
- Rename types and functions per §3, §6, §7 and §9.2, including runner internals (`routedAdapter`, `touchpointAdapter`) and component names.
- Rename the plugin kinds (`driver` → `client`, `adapter` → `executor`, `observer` → `executor-observer`) and the `automation` property (→ `observationContract`) on executor and executor observer plugins.
- Replace contract identifiers with namespaced, versioned ones (§5.1, §9.3).
- Update the host schema, plugin loader, assembly and validation, and the configuration keys per §12.6, with the errors from §12.7. Update `examples/nextcloud-filesharing/mesh.yaml`.
- Introduce run-record version 2 with the version-1 reader (§10.6). This belongs in step A because the rename changes persisted names.
- Update the `scripts/lint.mjs` prefixes (§14.6) in the same commit as the package renames.
- Update CI: the `--filter` targets in `.github/workflows/*.yml` and the bin names in `run-ci.sh` (`journey-adapter-appium` → `journey-executor-appium`).
- Verify: Web, Android and mixed journeys pass; reports on a recorded version-1 run are unchanged.

### Step B — Structural moves

- Split `journey-platform-android` into the platform, toolkit and service packages (§5.2), including the Gradle topic and the `android check` bin.
- Organize `journey-vendor-nextcloud` into `shared/`, `web/`, `android/`, `environments/` and `services/` (§8.1). Public subpath exports stay as they are.
- Add `./observation` entry points to both executors and move every observer onto them (§9.9).
- Behavior is unchanged: service lifecycle, environment lifecycle and session cleanup tests pass.

### Step C — Hardening and documentation

- Add the new lint rules (§14.6).
- Update `README.md`, `docs/architecture.md`, `docs/service-composition.md`, diagrams, terminology and configuration examples. Document vendor integration and observer extension requirements, including observation categories and boundaries (§9.6).
- Add a minimal second-vendor Web client example that uses only `defineClientPlugin()` and `webClientContract`, and confirm it needs no runner change.
- Validate reporting (§16, Reporting): observer outputs; Axe, Android accessibility and operability interpretation; UX measurements; runtime diagnostic artifacts; rendering; and comparison against a version-1 baseline.

### Step D (optional) — Shared vendor infrastructure

Needed only when a second vendor is implemented. Both extractions preserve behavior:

- Move the generic binding resolver out of `journey-vendor-nextcloud/src/shared/resolver.ts` into a shared helper (for example a `./client` entry of `journey-plugin`), so vendors do not copy it.
- Move the generic Compose stack lifecycle out of the Nextcloud stack service into `journey-service-docker`, leaving Nextcloud bootstrap (`occ`, apps, trusted domains, users) as a vendor hook. `journey-service-docker` then becomes a real service package, and `composeLifecycle` stays its topic.

---

## 18. Acceptance criteria

### Architecture

- Platform contracts are independent of automation and vendors.
- Android platform, runtime, and services are separate.
- Vendor clients implement platform contracts.
- Executors consume platform client contracts.
- Runner has no concrete platform or vendor dependencies.
- Dependency rules are automatically enforced.

### Naming

- `driver` is replaced by `client` in active public APIs.
- `adapter` is replaced by `executor` in active public APIs.
- Executor-attached observers have explicit terminology.
- Runtime observers retain their distinct terminology.
- Configuration and package names are consistent.
- Contract ID migrations are coordinated.
- Client and observation contract identifiers are namespaced and versioned.

### Observation

- Journey, executor, and runtime observation boundaries remain distinct.
- Executor observers use explicit automation compatibility contracts.
- Runtime observers remain independent of executors.
- Multiple compatible executor observers can be composed.
- Existing Axe observation works.
- Existing Android accessibility observation works.
- Existing UX observation works.
- Existing operability observation works.
- Existing Docker runtime observation works.
- Observers import executor observation contracts only through `./observation`, and that entry loads no automation runtime.
- Observer output and error propagation remain correct.
- Strict observer policies preserve existing verdict semantics.

### Reporting

- Interpreters operate from recorded evidence only.
- Observers do not import report renderers.
- Reporting does not trigger new automation.
- Reporting failures do not alter execution verdicts.
- Historical run records remain readable: version-1 records are normalized on read, and reports on them do not change.
- Comparisons remain supported, including a version-1 baseline against a version-2 run.

### Execution

- Web journeys pass.
- Android journeys pass.
- Mixed Web/Android journeys pass.
- Service lifecycle tests pass.
- Environment lifecycle tests pass.
- Session cleanup remains correct.

### Extensibility

- A second vendor can implement a Web client without core changes.
- Vendors may implement only a subset of platforms.
- New executor observers can be introduced without modifying vendors.
- New runtime observers can subscribe to declared runtime topics without modifying executors.
- Future iOS support fits the architecture without altering existing platform contracts.

### Quality

- Type checking passes.
- Unit tests pass.
- Integration tests pass.
- Architecture tests pass.
- CI passes.
- Documentation matches the implementation.

---

## 19. Out of scope

This refactoring does not include:

- Implementing iOS.
- Implementing complete Moodle or Mastodon integrations.
- Adding new UJG operation semantics.
- Changing journey compilation behavior.
- Replacing Playwright or Appium.
- Introducing a mandatory vendor runtime plugin.
- Adding multi-environment composition.
- Redesigning report models.
- Creating a universal observer abstraction.
- Introducing an observation event bus for executor observation.
- Rewriting existing measurement algorithms without a specific correctness requirement.
- Narrowing observer capabilities (§9.10).
- Shared vendor infrastructure (§17, step D), unless a second vendor is implemented.

---

## 20. Final architecture contract

The resulting architecture must obey these rules:

**Runner**

Orchestrates modeled journeys and execution lifecycles.

**Platform**

Defines typed compatibility boundaries between clients and executors.

**Vendor**

Distributes application-specific integrations.

**Client**

Resolves deterministic application-specific bindings.

**Executor**

Performs modeled operations using automation technologies.

**Toolkit**

Supplies reusable platform infrastructure operations, such as Android SDK and ADB utilities.

**Service**

Manages infrastructure acquisition and release.

**Environment**

Manages application fixtures and effect verification.

**Profile**

Selects applicable interaction modalities.

**Journey Observer**

Observes runner and execution lifecycle events.

**Executor Observer**

Observes operations through a compatible executor and may contribute findings or policy failures.

**Runtime Observer**

Observes infrastructure events independently of execution sessions.

**Report Interpreter**

Transforms persisted evidence into structured, presentation-independent report data.

### Architectural invariant

A new vendor, platform, executor, or observer must be introducible by implementing the appropriate established contracts.

No concrete integration may require changes to the runner simply because a new vendor, platform, automation engine, or observation mechanism has been introduced.

**The result should be a vendor-independent, multi-platform, multi-observer Journey Mesh with explicit ownership, compatibility, lifecycle, and reporting boundaries.**
