[![Nextcloud Filesharing CI](https://github.com/openuji/journey-mesh/actions/workflows/example-ci.yml/badge.svg?event=pull_request)](https://github.com/openuji/journey-mesh/actions/workflows/example-ci.yml)

# Nextcloud file-sharing tests

[`journey.yaml`](./journey.yaml) defines the tests, their selected journeys,
adapters, drivers, observers, interaction profiles, credentials, and output.
The same Journey Mesh command executes any configured runtime combination.

- `browser-sharing`: Alice and Bob use the web adapter, with default and
  keyboard-only profile combinations.
- `native-recipient-sharing`: Alice uses the web adapter and Bob uses Appium,
  with default-web/touch-Android and keyboard-web/touch-Android combinations.

Each test executes Alice's selected journey followed by Bob's selected journey.
It has one shared fixture lifecycle per profile and one report. Native bindings
come from the checked-in Android model; runtime selection does not rewrite them.

## Run

Run these commands from this example directory.

Prepare the local services first. See [`deployment/README.md`](deployment/README.md)
for canonical URL requirements. The default host needs to resolve
`host.docker.internal`.

```sh
pnpm stack:up
pnpm stack:provision
pnpm stack:seed
pnpm exec journey-mesh validate journey.yaml --test browser-sharing
pnpm exec journey-mesh test journey.yaml --test browser-sharing
```

From the repository root, the browser-only command is:

```sh
pnpm exec journey-mesh test examples/nextcloud-filesharing/journey.yaml --test browser-sharing
```

Omitting `--test` selects both configured tests. Both must pass preflight before
any fixtures or browsers start, so that command also requires Android setup and
`ANDROID_UDID`. Use `adb devices` to find the ID of your dedicated test emulator
or device; its Appium server and pinned APK must also be ready.

The existing shortcuts call this same CLI:

```sh
pnpm e2e
pnpm e2e:headed
pnpm e2e:android
pnpm journey:test       # all tests declared in journey.yaml
pnpm e2e:report
```

For Android, prepare the pinned APK, Appium server, and a dedicated emulator or
device first. See [Android setup](../../docs/nextcloud-android.md).
`ANDROID_UDID` is required only when selecting a test using that adapter.
`android:check` checks tooling/runtime pins before `e2e:android`.

Environment files load defaults, local deployment overrides, and an optional
`NEXTCLOUD_STACK_ENV_FILE`, followed by process-environment overrides. Use
`HEADLESS=false` to watch browser execution. `AXE_STRICT=true` and
`ANDROID_A11Y_STRICT=true` enable the observers' reporting failure policies.

## Configuration and lifecycle

Read [YAML test configuration](../../docs/yaml-tests.md) for the complete contract.
Changing the selected journey and adapter in YAML changes where execution runs;
there are no platform-specific runner files.

`environment.ts` is a factory for this application's fixture cleanup, fixture
creation, and OCS/WebDAV effect checks. It receives service/account data from YAML
and does not load deployment credentials when imported. UI entry routes and
transition values are YAML data interpreted by driver plugins.

All selected tests preflight before fixtures are modified. Each profile sets up
shared services once, executes its configured journeys in order, closes runtime
resources, and tears down fixtures. Failures retain evidence and cleanup errors.

## Evidence and reports

```sh
pnpm exec journey-mesh report test-results
```

The report root contains `index.html` and `journey-results.json`. Each test has a
subdirectory, such as `test-results/browser-sharing/`, containing:

- `ujg-evidence.json`: immutable functional outcomes with model, journey-item,
  and adapter provenance.
- `ujg-summary.json`: functional results, reporting errors, and artifact links.
- `index.html`: test summary and links to observer artifacts.
- Axe path HTML/JSON, accessibility summaries, and source screenshots.
- For native execution: hierarchy evidence, screenshots, device metrics,
  accessibility HTML/JSON, and APK/runtime metadata.

Reports are standalone files and do not require Playwright Test. Accessibility
findings support review; they do not establish WCAG or TalkBack conformance.
The API 35 x86_64 Android CI gate remains open until that actual workflow target
completes successfully. Existing API 37 arm64 captures do not close it.
