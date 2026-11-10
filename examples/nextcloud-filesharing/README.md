[![Nextcloud Filesharing CI](https://github.com/openuji/journey-mesh/actions/workflows/example-ci.yml/badge.svg?event=pull_request)](https://github.com/openuji/journey-mesh/actions/workflows/example-ci.yml)

# Nextcloud file-sharing tests

[`mesh.yaml`](./mesh.yaml) defines the tests, their selected journeys,
adapters, drivers, observers, interaction profiles, credentials, and output.
The same Journey Mesh command executes any configured runtime combination.

- `browser-sharing`: Alice and Bob use the web adapter, with default and
  keyboard-only profile combinations.
- `native-recipient-sharing`: Alice uses the web adapter and Bob uses Appium,
  with default-web/touch-Android and keyboard-web/touch-Android combinations.

Each test first executes explicit Alice and Bob login setup journeys, whose
operations use `urn:phase:setup`, followed by Alice's offer and Bob's acceptance
journeys. Accessibility observers journal setup operations as not applicable
without taking screenshots or auditing them.
It has one shared fixture lifecycle per profile and one report. Native bindings
come from the checked-in Android model; runtime selection does not rewrite them.

## One-time prerequisites

Run the commands in this guide from `examples/nextcloud-filesharing` unless a
repository-root path is shown. Install Node 22.22.2 or newer in the Node 22 line,
pnpm, Docker with Compose, and the workspace dependencies:

```sh
pnpm install --frozen-lockfile
pnpm build
```

The web adapter installs its own pinned Chromium build automatically, the
first time any browser-based test launches one; there is no separate install
step. On Linux, if that first launch fails because Chromium can't start,
install its system dependencies once with
`pnpm --filter @openuji/journey-adapter-playwright exec playwright install --with-deps chromium`.

Native execution additionally requires a current Android Studio installation and
an `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) pointing at its SDK. The lifecycle
command uses Android Studio's bundled Java and Android CLI when standalone SDK
tools are absent. Linux hosts need working KVM access. Local native execution is
supported on Apple Silicon and Intel macOS, and x86-64 Linux.

## Start the Nextcloud stack

The stack lifecycle owns Docker and the canonical service URLs:

```sh
pnpm stack:up
pnpm stack:provision
pnpm stack:seed
```

`stack:up` starts only the containers. It discovers a host IPv4 address reachable
from the host browser, Docker containers, and Android, then writes the effective
configuration to `.runtime/stack.env`. Provisioning creates the users and
federation configuration; seeding uploads `report.pdf` for Alice.

Set `NEXTCLOUD_STACK_HOST` to a reachable IPv4 address before `stack:up` to
override discovery. `NEXTCLOUD_STACK_ENV_FILE` can select a complete custom
environment file. Later stack commands reuse the generated runtime environment.

## Run the browser test

Execution stays entirely in the YAML test specification:

```sh
pnpm exec journey-mesh validate mesh.yaml --test browser-sharing
pnpm exec journey-mesh test mesh.yaml --test browser-sharing
```

The test runs both its default and keyboard-only profiles. Set `HEADLESS=false`
to watch the browsers. `AXE_STRICT=true` enables the browser accessibility
observer's reporting failure policy.

## Start the optional native runtime

Android and Appium have separate lifecycles:

```sh
pnpm android:up
pnpm appium:up
```

`android:up` runs via `@openuji/journey-driver-android`'s runtime, installs
missing platform tools, emulator, command-line tools, and the host-native
Google APIs API 35 image. It creates or validates the dedicated Pixel 6 AVD
`journey-mesh-api35`, boots headlessly, disables animations, and writes the
active device ID to `.runtime/android.env`. The first run downloads several
large components and may show Android SDK license prompts. An existing AVD
with the same name is reused only when its API, image architecture, and
device profile match the pins. These device pins — `api`, `avd`, `image`,
`localImages`, `profile`, `locale`, `requiredPackages` — live directly in
`mesh.yaml`'s `runtimes.android.options`; there is no separate manifest file.

`appium:up` runs via `@openuji/journey-adapter-appium`'s runtime, verifies that
device, installs the pinned UiAutomator2 driver into a versioned repository
cache, starts Appium on port 4723, waits for readiness, and writes
`.runtime/appium.env`. It neither starts Nextcloud nor runs a journey — nor
does it download the Nextcloud APK; the adapter's own plugin does that
automatically the first time a native test actually runs (same as Chromium
for the web adapter — see "One-time prerequisites" above), from the `application`
block already declared in `adapters.android.options`. Appium logs are stored
under `.tmp/appium-runtime/`; emulator logs are under `.tmp/android-runtime/`.

Both `android:up` and `appium:up` are the generic
`journey-mesh runtime up mesh.yaml --runtime <key>` command underneath —
`pnpm android:up`/`pnpm appium:up` are just this example's own thin script
names for `--runtime android`/`--runtime appium`. Overrides go through
`mesh.yaml`'s `runtimes.<key>.options` (interpolated the same way as every
other option in this file), not CLI flags:

```yaml
runtimes:
  android:
    options:
      avd: '${ANDROID_AVD_NAME:-journey-mesh-api35}'
      # api, image, localImages, profile, locale, requiredPackages also live here
  appium:
    options:
      port: '${APPIUM_PORT:-4723}'
```

So `ANDROID_AVD_NAME=another-dedicated-avd pnpm android:up` and
`APPIUM_PORT=4725 pnpm appium:up` override without editing the YAML.
`ANDROID_CLI`, `ANDROID_STUDIO_HOME`, and `APPIUM_HOME` provide further
environment-level overrides read directly by the runtime, same as before.
Global Appium installations are never modified.

## Run the native-recipient test

With the stack, Android, and Appium ready, the execution command still selects
only the YAML test:

```sh
pnpm exec journey-mesh validate mesh.yaml --test native-recipient-sharing
pnpm exec journey-mesh test mesh.yaml --test native-recipient-sharing
```

This runs `default-web-touch-android` and
`keyboard-only-web-touch-android`. Set `ANDROID_A11Y_STRICT=true` to enable the
native accessibility observer's reporting failure policy. Omitting `--test`
selects both configured tests and therefore requires both runtime lifecycles.

From the repository root, the same selections are:

```sh
pnpm exec journey-mesh test examples/nextcloud-filesharing/mesh.yaml --test browser-sharing
pnpm exec journey-mesh test examples/nextcloud-filesharing/mesh.yaml --test native-recipient-sharing
```

## Stop local services

Stop the optional native services in reverse order:

```sh
pnpm appium:down
pnpm android:down
```

These commands stop only the processes recorded for this example. They retain
the AVD, Android SDK packages, APK, Appium cache, reports, and Nextcloud data.
`ANDROID_AVD_NAME=another-dedicated-avd pnpm android:down` stops a named override.

To delete the Nextcloud containers and their service volumes, run:

```sh
pnpm stack:reset
```

This is a destructive backend reset; reports and Android assets are retained.
Detailed native bindings, evidence limits, and review status are in
[Nextcloud Android](../../docs/nextcloud-android.md). The CI-only
[`run-ci.sh`](../../.github/workflows/run-ci.sh) helper, beside the Android
workflow it belongs to, continues to own its temporary Appium and logcat
processes.

## Configuration and lifecycle

Read [YAML test configuration](../../docs/yaml-tests.md) for the complete contract.
Changing the selected journey and adapter in YAML changes where execution runs;
there are no platform-specific runner files.

`@openuji/journey-driver-nextcloud/federated-sharing/plugin` owns fixture cleanup,
fixture creation, and OCS/WebDAV effect checks. This example supplies only the
service/account values, fixture path/name, and journey effect IDs in YAML. UI
entry routes and transition values are likewise YAML data interpreted by driver
plugins.

All selected tests preflight before fixtures are modified. Each profile sets up
shared services once, executes its configured journeys in order, closes runtime
resources, and tears down fixtures. Failures retain evidence and cleanup errors.

## Evidence and reports

From the repository root:

```sh
pnpm exec journey-mesh report examples/nextcloud-filesharing/test-results
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
Both native-recipient profiles have passed locally on API 35 arm64.
The API 35 x86_64 CI target requires its own successful workflow run.
