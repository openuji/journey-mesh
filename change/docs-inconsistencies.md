# Journey Mesh — Documentation & Architecture Inconsistencies Review

**Date:** 2026-11-24  
**Target Branch:** `docs/review` (based on `origin/main` @ `4ea7a0e`)  
**Scope:** Review of documentation against the post-refactoring implementation (PRs #22, #23, #24, #25).

---

## 1. Executive Summary

Following the completion and merge of the architectural refactoring (PRs #22 through #25: terminology renames, Android package split, shared vendor infrastructure, and architecture lint rules), the documentation across `docs/`, `README.md`, and package READMEs was audited against the concrete codebase.

While high-level terminology (`client`, `executor`, `./observation` entry points) is well aligned, several critical inconsistencies exist:
1. **Fictitious APIs and Contracts in `docs/service-composition.md`:** The documentation specifies non-existent Compose utilities (`entrypointFinished`, `composeCommand`) and a generic `composeStackContract` that was never introduced; the actual codebase uses Nextcloud-specific stack contracts.
2. **Signature Mismatches:** `startComposeStack` is documented with a non-existent `ports` argument, omitting its actual `{ observations }` parameter.
3. **Execution Composition Terminology in `README.md`:** Mentions "Hooks" in diagrams and text where `JourneyEnvironment` is the actual runner contract.
4. **Documentation Gaps:** 12 workspace packages lack a `README.md`, including `journey-executor-appium`, `journey-plugin`, and core observers.
5. **Specification Status:** `change/refactoring.md` is still marked as "Proposed" despite all milestones being merged.

---

## 2. Detailed Inconsistencies

### 2.1 Category 1: Docker Compose & Service Composition (`docs/service-composition.md`)

#### 1. Fictitious `entrypointFinished` Tool in `bootstrap` Hook
* **Location:** [`docs/service-composition.md#L103-L108`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/docs/service-composition.md#L103-L108), [`docs/service-composition.md#L133`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/docs/service-composition.md#L133)
* **Documented:**
  > *"Besides `run` and `compose`, the hook gets `entrypointFinished(service, script)`: whether the image has finished its entrypoint script (PID 1 is no longer that script)."*
  ```ts
  while (!await entrypointFinished("moodle", settings.entrypointScript)) await new Promise((done) => setTimeout(done, 1000));
  ```
* **Actual Code ([`packages/journey-service-docker/src/compose.ts#L42-L43`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/packages/journey-service-docker/src/compose.ts#L42-L43)):**
  ```ts
  export type ComposeProjectTools = ComposeTools & Readonly<{ compose(...args: string[]): Promise<string> }>;
  ```
  `ComposeProjectTools` supplies only `{ run, compose, signal }`. Checking whether PID 1 is still the entrypoint script is only implemented locally inside Nextcloud stack ([`packages/journey-vendor-nextcloud/src/services/stack/stack.ts#L140`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/packages/journey-vendor-nextcloud/src/services/stack/stack.ts#L140)) as:
  ```ts
  const started = (service: string) => docker("exec", "-T", service, "cat", "/proc/1/cmdline").then((cmdline) => !cmdline.includes("entrypoint.sh"), () => false);
  ```
  It was never generalized into `journey-service-docker/compose`.

#### 2. Non-existent `composeStackContract`, `ComposeStack`, and `composeCommand`
* **Location:** [`docs/service-composition.md#L116-L121`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/docs/service-composition.md#L116-L121)
* **Documented:**
  > *"A stack service outputs the running stack as `composeStackContract` (`ComposeStack`: project, Compose files, env file, services). Services that act inside a stack, such as Nextcloud's `app-install`, take it as an input and address the project with `composeCommand(stack)`. Any Compose stack satisfies the contract, so such a service checks that the services it needs are in `stack.services`."*
* **Actual Code:**
  - `composeStackContract` does not exist anywhere in the repository.
  - `ComposeStack` type does not exist.
  - `composeCommand()` function does not exist.
  - Nextcloud's stack output is `managedStackContract` (`contract<ManagedStack>("@openuji/nextcloud-stack/v1")`), defined in [`packages/journey-vendor-nextcloud/src/services/contracts.ts#L7`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/packages/journey-vendor-nextcloud/src/services/contracts.ts#L7).
  - `app-install` takes `stack: managedStackContract` and formats its own `compose` arguments directly ([`packages/journey-vendor-nextcloud/src/services/app-install/app-install.ts#L32`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/packages/journey-vendor-nextcloud/src/services/app-install/app-install.ts#L32)):
    ```ts
    const compose = ["compose", "--project-name", stack.project, "--env-file", stack.envFile, ...stack.composeFiles.flatMap((file) => ["-f", file])];
    ```

#### 3. `startComposeStack` Signature Mismatch
* **Location:** [`docs/service-composition.md#L92`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/docs/service-composition.md#L92)
* **Documented:** `startComposeStack(stack, hooks, ports)`
* **Actual Code ([`packages/journey-service-docker/src/compose.ts#L90-L94`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/packages/journey-service-docker/src/compose.ts#L90-L94)):**
  ```ts
  export async function startComposeStack(
    stack: ComposeStackOptions,
    hooks: ComposeStackHooks,
    { observations }: Readonly<{ observations: ObservationPublisher }>,
    { execute = executeComposeCommand, signal }: Readonly<{ execute?: ComposeExecutor; signal?: AbortSignal }> = {}
  ): Promise<StartedService>
  ```
  `ports` is not a parameter; the third parameter is `{ observations }`.

#### 4. Package Naming Contradiction in Table
* **Location:** [`docs/service-composition.md#L59-L71`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/docs/service-composition.md#L59-L71)
* **Documented:** The table lists `journey-service-git/plugin`, `journey-vendor-nextcloud/app-build/service`, etc., without `@openuji/` prefixes. Line 71 directly contradicts this: *"All package names in the table have the `@openuji/` prefix."*

---

### 2.2 Category 2: Architecture & Boundary Classification (`docs/architecture.md`)

#### 1. Layer and Role of `journey-run-record`
* **Location:** [`docs/architecture.md#L35`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/docs/architecture.md#L35)
* **Documented:** Under the layer table:
  ```markdown
  | Execution | `journey-core`, ..., `journey-run-record`, ... | Plans, executions, evidence. Never reports. |
  ```
* **Actual Architecture ([`docs/architecture.md#L16-L26`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/docs/architecture.md#L16-L26), [`scripts/lint.mjs#L38`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/scripts/lint.mjs#L38)):**
  `journey-run-record` is the shared disk boundary read directly by the reporting layer (`journey-reporter` imports `openRunRecord` / `readRunRecord`). Grouping it strictly under Execution with *"Never reports"* is contradictory. It is classified under execution in lint solely to forbid it from importing reporting packages, not because it cannot be read by reporting.

#### 2. Incomplete Reporting Diagram
* **Location:** [`docs/architecture.md#L20`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/docs/architecture.md#L20)
* **Documented:** `interpreters["journey-report-axe<br/>journey-report-android<br/>journey-report-operability"]`
* **Actual Architecture:**
  UX observation (`journey-observer-ux`) derives measurements directly into its `JourneyObserverOutput` without an intermediate `journey-report-*` interpreter package; these measurements are ingested by `journey-reporter` directly. Clarifying this in the architecture diagram prevents confusion about whether a `journey-report-ux` package is missing.

---

### 2.3 Category 3: Runner & Execution Terminology (`README.md`)

#### 1. "Hooks" vs `JourneyEnvironment`
* **Location:** [`README.md#L81`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/README.md#L81), [`README.md#L105`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/README.md#L105)
* **Documented:** Diagram shows `I["Hooks (Fixtures)"] --> D` and text says *"Optional environment hooks own shared fixture setup, declared-effect verification, and teardown."*
* **Actual Code ([`packages/journey-runner/src/run-journey.ts#L36`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/packages/journey-runner/src/run-journey.ts#L36)):**
  `runJourney` takes `environment?: JourneyEnvironment`. The codebase reserves the term "hooks" for Compose lifecycle hooks (`prepare`, `bootstrap`); using "hooks" for environments confuses environment plugins with Compose hooks.

#### 2. Missing Modules in Catalog
* **Location:** [`README.md#L405-L412`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/README.md#L405-L412)
* **Documented:** The "Available integrations and examples" list omits several components present in the monorepo:
  - Docker runtime observer (`@openuji/journey-observer-docker`)
  - Operability observer (`@openuji/journey-observer-operability`) and interpreter (`@openuji/journey-report-operability`)
  - Git checkout service (`@openuji/journey-service-git`)
  - HTTP environment fixtures and effect verification (`@openuji/journey-environment-http`)
  - APK build service (`@openuji/journey-service-android/apk-build/service`)

---

### 2.4 Category 4: Documentation Gaps (Missing Package READMEs)

While 16 packages include complete `README.md` documentation, **12 packages currently lack documentation files**:

1. **`packages/journey-executor-appium/`** (Critical: `journey-executor-playwright` has detailed documentation, while Appium executor options, capabilities, and `./service` exports are undocumented).
2. **`packages/journey-plugin/`** (Critical: Central SDK package defining `defineClientPlugin`, `defineExecutorPlugin`, `clientBindings`, and node utilities).
3. **`packages/journey-observer-axe/`** (Only `journey-report-axe` has a README).
4. **`packages/journey-observer-android-accessibility/`** (Only `journey-report-android` has a README).
5. **`packages/journey-observer-docker/`** (Observer has no README; only mentioned briefly in `journey-service-docker`).
6. **`packages/journey-service-git/`**
7. **`packages/journey-profiles/`**
8. **`packages/journey-runner/`**
9. **`packages/journey-host/`**
10. **`packages/journey-cli/`**
11. **`packages/journey-core/`**
12. **`packages/journey-execution-model/`**

---

### 2.5 Category 5: Specification Status vs Codebase Reality (`change/refactoring.md`)

* **Location:** [`change/refactoring.md#L3`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/change/refactoring.md#L3), [`change/refactoring.md#L1336-L1373`](file:///Users/zavalit/Projects/openuji/funding/applications/fediversity/journey-mesh/change/refactoring.md#L1336-L1373)
* **Documented:**
  - `**Status:** Proposed (revised after code review, 2026-11-24)`
  - Steps A, B, C, and D are framed as future implementation work.
* **Actual Code:**
  All four steps have already been implemented and merged:
  - Step A: PR #22 (`refactor: client/executor terminology, run record v2`)
  - Step B: PR #23 (`refactor: split Android packages, Nextcloud layout, ./observation entries`)
  - Step D: PR #24 (`refactor: shared client bindings and Compose stack lifecycle`)
  - Step C: PR #25 (`refactor: architecture lint rules, docs, second-vendor proof`)

---

## 3. Recommended Remediation Plan

1. **`docs/service-composition.md`**:
   - Align `startComposeStack` signature with `(stack, hooks, { observations }, { execute, signal }?)`.
   - Either extract `entrypointFinished` into `ComposeProjectTools` in `packages/journey-service-docker/src/compose.ts` or remove its mention from the doc.
   - Either generalize `ManagedStack` into a shared `composeStackContract` (`ComposeStack`) or document that stack outputs are currently vendor-defined.
   - Fix table prefix contradiction.
2. **`README.md`**:
   - Replace `Hooks (Fixtures)` with `Environment (Fixtures)` in the architecture diagram and text.
   - Add missing modules to the integrations list.
3. **`docs/architecture.md`**:
   - Clarify the layer table row for `journey-run-record` to reflect its status as the shared boundary contract read by reporting.
4. **Package Documentation**:
   - Add `README.md` to `packages/journey-executor-appium/` and `packages/journey-plugin/`.
5. **`change/refactoring.md`**:
   - Update status to **Completed** (Merged in PRs #22, #23, #24, #25).
