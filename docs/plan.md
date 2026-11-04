# Nextcloud Android implementation

Historical implementation plan. The platform-specific hosting described here was
subsequently replaced by [YAML-defined journey tests](yaml-tests.md); runtime pins
and the remaining API 35 integration gate still apply.

## Summary

Add an explicit Alice-web/Bob-Android execution alongside the existing web example. Include a native accessibility observer with limited hierarchy checks, plus Android CI triggered by both pull requests and manual dispatch.

Build on the feature branch’s existing routing, shared environments, profile assessments, immutable outcomes, and adapter provenance. Extend its separation between I/O collection and pure processing.

## Interfaces and architecture

- Add `@openuji/journey-adapter-appium`, exporting `appiumAdapter`, native driver/session contracts, and `AppiumExecutionObserver`. Use WebdriverIO’s standalone client; Journey Mesh retains execution order and outcomes.
- Add `@openuji/journey-driver-nextcloud-android`, exporting `nextcloudAndroidDriver`. It owns Nextcloud login, native entry navigation, readiness, and actor/touchpoint session selection.
- Add `@openuji/journey-observer-android-accessibility`, exporting `androidAccessibilityObserver`, immutable evidence types, and pure hierarchy-check/report builders.
- Expose existing Nextcloud service configuration types and HTTP helpers through `@openuji/journey-driver-nextcloud/service`. Preserve existing root exports. Separate the example’s shared service environment from browser driver configuration.
- Keep the runner’s runtime-neutral contracts intact: open modality IDs, optional decisions for no-input transitions, immutable `outcome` values, assessment-based applicability, and console imports from `/console`.

## Implementation sequence

### 1. Establish the native flow

- Start with Nextcloud Android **35.0.2**, using `nextcloud-350000290.apk` and its published SHA-256. Record the APK, Android image, locale, and automation versions in a checked-in runtime manifest. [Official release assets](https://github.com/nextcloud/android/releases/expanded_assets/stable-35.0.2).
- Pin Appium **3.9.0**, UiAutomator2 **8.7.3**, and WebdriverIO **9.20.0**. The documented compatibility matrix pairs UiAutomator2 5–8 with Appium 3. [UiAutomator2 requirements](https://appium.github.io/appium-uiautomator2-driver/latest/getting-started/).
- On a dedicated emulator, verify scripted login, receipt of Alice’s offer, native acceptance, disappearance of the pending offer, and visibility of the mounted file. Capture hierarchy fixtures and identify actual native controls.
- Treat this as an integration gate. If the APK cannot perform a required native action, record the unsupported behavior and stop that integration path. HTTP checks continue to verify effects; they must not perform Bob’s modeled acceptance.

### 2. Implement Appium execution

- Follow the existing adapter lifecycle. Allocate sessions only inside execution, register each returned session before login, and delete all owned sessions during cleanup, including after partial startup. Continue cleanup after errors and preserve earlier failures.
- Keep resource ownership and lifecycle bookkeeping local to execution. Do not introduce mutable result flags or a global execution registry.
- Translate the model’s touch-tap modality into an adapter-owned tap command. Reject unsupported modalities before interaction.
- Implement pure locator-to-query translation with explicit supported roles, native features, names, and context chains. Preserve binding intersection, alternative-binding union, deduplication, and exact match counts. Reject unsupported semantics.
- For no-input transitions, invoke the driver’s completion/wait hook without resolving or activating a target.
- Emit native observation stages corresponding to state assertion, transition readiness, no-input completion, and control flow.

### 3. Bind the Nextcloud journey

- Add checked-in Android YAML and JSON-LD variants. Compile the Android document directly; do not patch the compiled plan.
- Preserve Alice’s web bindings and existing domain state, effect, and artifact IDs wherever their meaning remains valid. Bind Bob’s entries, surfaces, locators, and modalities to the verified native flow.
- Use distinct IDs for any native navigation whose meaning differs from the web transition. Keep the Android document ID distinct.
- Add `e2e:android` with two composite profiles: default-web/touch-Android and keyboard-web/touch-Android. Route Alice to Playwright and Bob to Appium.
- Reuse `nextcloudEnvironment` once per applicable profile for fixture setup, OCS/WebDAV verification, and teardown. Native driver hooks must not duplicate those operations.
- Use fresh Nextcloud app data and scripted Bob login for each profile on the dedicated test device.

### 4. Collect immutable native evidence

- Collect native hierarchy, device metrics, matched-target identities, and screenshots at the Appium boundary. Snapshot model metadata before asynchronous collection.
- Append detached, deeply frozen facts scoped by run, execution, profile, and operation. Runtime handles remain outside evidence.
- Implement pure hierarchy normalization, checks, path classification, summaries, and JSON/HTML report construction. Supply timestamps explicitly; getters and rendering must not change evidence.
- Initially report potential missing labels on actionable controls and potential touch targets below **48 × 48 dp**. Use captured density for conversion; missing information produces an explicit unassessed result. Document grouping and expanded-hit-area limitations. [Android accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/apps#touch-targets).
- Journal collection failures before propagating them. Publish latest-report references only after the complete artifact bundle succeeds.
- Use `RunResult.evidence` for adapter attribution. Actual observations take precedence; foreign attempted operations are not applicable, while missing provenance or unreached operations must not imply another adapter.
- Report findings by default. `ANDROID_A11Y_STRICT=1` makes findings fail reporting after artifacts are written. Functional and configured evidence-collection failures fail the run without mutating its published result.

### 5. Add reproducible execution and CI

- Keep the existing web commands and workflow. Add an Android workflow with `pull_request` and `workflow_dispatch` triggers, one worker, an API 35 emulator, bounded startup waits, and pinned tooling.
- Configure canonical Nextcloud URLs reachable from the host, both containers, and Android. In Linux CI, use the Docker host bridge address; document an explicit reachable host address for local execution.
- Always upload runner evidence, native reports, hierarchy snapshots, screenshots, Appium logs, and existing axe artifacts. Always stop owned runtime processes and reset the stack.
- Update the Android migration document and example README with commands, versions, setup, evidence interpretation, and implemented limits.

## Validation and acceptance

- **Adapter contracts:** modality rejection, locator composition and counts, no-input behavior, isolated sessions, partial startup, repeated close, and combined cleanup failures.
- **Pure processing:** identical inputs produce identical reports; published values are frozen and detached; repeated reads/rendering do not append facts; reused observers keep runs separate.
- **Mixed execution:** shared fixtures run once per profile; effects run after successful transitions; progress and provenance identify the executing adapter, including failures.
- **Reporting:** preserve functional failures, distinguish foreign and unreached operations, retain capture failures, and derive strict failures from all completed checks.
- **Real execution:** both composite profiles complete native acceptance and mounted-file verification, with evidence indexed by model IDs.
- Run workspace build, typecheck, lint, tests, and runner-portability checks. The current typecheck and test baseline already passes.

## Defaults and limits

- Keep UJG **1.0-rc1**.
- Accessibility findings are limited hierarchy heuristics; they do not establish TalkBack behavior or WCAG conformance.
- Native support remains unverified until the APK gate completes; existing native stand-ins provide contract coverage only.
