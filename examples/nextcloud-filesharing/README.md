[![Nextcloud Filesharing CI](https://github.com/openuji/journey-mesh/actions/workflows/example-ci.yml/badge.svg?event=pull_request)](https://github.com/openuji/journey-mesh/actions/workflows/example-ci.yml)

# Nextcloud file-sharing tests

[`journey.yaml`](./journey.yaml) defines the tests, their selected journeys,
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
device first. Follow [Run Android locally](#run-android-locally) below.
`ANDROID_UDID` is required only when selecting a test using that adapter.
`android:check` checks tooling/runtime pins before `e2e:android`.

Environment files load defaults, local deployment overrides, and an optional
`NEXTCLOUD_STACK_ENV_FILE`, followed by process-environment overrides. Use
`HEADLESS=false` to watch browser execution. `AXE_STRICT=true` and
`ANDROID_A11Y_STRICT=true` enable the observers' reporting failure policies.

## Run Android locally

Run the launcher from this example package:

```sh
cd examples/nextcloud-filesharing # from the repository root
pnpm android:local
```

This uses your existing **`journey-mesh-api35`** AVD in headless mode, matching CI.
It finds the SDK from
`ANDROID_HOME`/`ANDROID_SDK_ROOT` or the standard macOS/Linux location, boots or
reuses that AVD, waits for Android, prepares the pinned APK/Chromium/Appium driver,
configures reachable Nextcloud URLs, starts/provisions the example stack, and
runs `native-recipient-sharing` using the same helper as CI. On macOS it starts
Docker Desktop if necessary. Keep Docker, JDK 21, the Android SDK, and that AVD
installed; the launcher handles the remaining setup.

You do not need to start Appium, choose ports, or export `ANDROID_UDID` manually.
The launcher selects free ports and derives the device serial. It refuses to use
an explicitly selected device belonging to a different AVD.

New emulator processes use `-gpu swiftshader -feature -Vulkan` to avoid a
gfxstream crash when Chrome is stopped between profiles. Reused emulators keep
their existing graphics settings; restart them with the manual command below
if they were launched with `swiftshader_indirect` or Vulkan enabled.

```sh
pnpm android:local --all                   # every test in journey.yaml
pnpm android:local --avd another-test-avd  # another dedicated AVD
```

On completion, failure, or interruption, it stops the emulator and example
containers it started. A previously running emulator or container is retained;
service volumes and reports are retained. Appium/logcat are stopped by the shared
CI helper. Logs are saved under the repository root's
`.tmp/android-local/<timestamp>/`; the report is this example's
`test-results/index.html`.

Optional overrides are `ANDROID_AVD_NAME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`,
`APPIUM_HOME`, and `NEXTCLOUD_ANDROID_HOST` (a reachable host IPv4 address).
`NEXTCLOUD_STACK_ENV_FILE`, if set, is used as supplied. The default Appium home is
an isolated, versioned cache inside the repository root's `.tmp/`; global Appium installations are not
changed. `pnpm android:local --help` lists the command options.

The manual steps below are for first-time SDK/AVD creation or debugging. Once the
AVD exists, use the launcher above.

<details>
<summary>Manual SDK/AVD setup and debugging</summary>

This follows the [Android CI job](../../.github/workflows/android-ci.yml), using
its checked-in [runtime pins](android/runtime.json) and
[`android/run-ci.sh`](android/run-ci.sh) helper. The helper starts Appium, waits
for its status endpoint, captures device/Appium logs, runs both native-recipient
profiles, and stops its Appium/logcat processes when finished. You start the
emulator and Nextcloud services before invoking it.

**All commands in this section run from the repository root.** Keep the main
terminal open so the exported variables remain available.

### 1. Prepare the tools

Install Node 22.22.2 or newer in the Node 22 line, npm 10+, pnpm, JDK 21, Docker
with Compose, and Android Studio. Docker must be running; Linux hosts also need
KVM access, matching the workflow's virtualization setup. Set `JAVA_HOME` to your
JDK 21 installation and check `java -version`.

In Android Studio's [SDK Manager](https://developer.android.com/studio/intro/update#sdk-manager),
install **Android SDK Platform-Tools**, **Android Emulator**, and a **Google APIs**
system image. Note the SDK location; the commands below use the macOS default:

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
# On Linux, use your SDK location, commonly "$HOME/Android/Sdk".
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
export APPIUM_HOME="$PWD/.tmp/appium"
export APPIUM_URL=http://127.0.0.1:4723/

pnpm install --frozen-lockfile
pnpm build
pnpm --filter @openuji/example-nextcloud-filesharing exec playwright install chromium
pnpm --filter @openuji/example-nextcloud-filesharing android:check
pnpm --filter @openuji/example-nextcloud-filesharing android:apk
pnpm --filter @openuji/example-nextcloud-filesharing exec appium driver install --source=local "$PWD/examples/nextcloud-filesharing/node_modules/appium-uiautomator2-driver"
```

On Linux, add `--with-deps` to the Playwright install command if browser system
libraries are missing, as CI does. The Appium driver install is a one-time step
for this `APPIUM_HOME`; skip it on later runs if UiAutomator2 is already installed.
Use the local pinned driver, not an unversioned download. The repository pins
Appium **3.9.0**, UiAutomator2 **8.7.3**, WebdriverIO **9.20.0**, and Nextcloud
Android **35.0.2**. `android:apk` downloads and verifies the APK automatically.

### 2. Create and start a dedicated emulator

Open Android Studio's **More Actions → Virtual Device Manager** from its welcome
screen, or **View → Tool Windows → Device Manager** inside a project. Create a
**Pixel 6** virtual device named `journey-mesh-api35`, with a Google APIs image:

| Host | Image architecture |
| --- | --- |
| Apple Silicon Mac | `arm64-v8a` |
| Intel/AMD host, including Linux CI | `x86_64` |

Use API 35 to match the CI target. Keep the system language **English (United
States)** and make sure the image includes Chrome. Use a dedicated test device:
the driver reinstalls Nextcloud for each profile and clears Chrome's app data
for login isolation. There is no need to install or sign into Nextcloud manually.
See Android's [device creation guide](https://developer.android.com/studio/run/managing-avds)
for the image-selection UI.

In a **second terminal**, launch that AVD and leave it running:

```sh
# macOS SDK path; replace it with your SDK location on Linux.
"$HOME/Library/Android/sdk/emulator/emulator" -list-avds
"$HOME/Library/Android/sdk/emulator/emulator" -avd journey-mesh-api35 -port 5554 -no-snapshot -no-boot-anim -gpu swiftshader -feature -Vulkan
```

The AVD name must match the one you created. If port 5554 is occupied, choose an
unused even port such as 5556 and use the matching `emulator-5556` ID below.
Alternatively, launch the dedicated AVD from Device Manager and use its actual
ID from `adb devices -l`.

Back in the **main terminal**, check the device:

```sh
adb devices -l
export ANDROID_UDID=emulator-5554
adb -s "$ANDROID_UDID" shell getprop sys.boot_completed
adb -s "$ANDROID_UDID" shell pm path com.android.chrome
```

Continue when the selected device is listed as `device`, boot status is `1`,
and the Chrome check returns a `package:` path. Wait for boot to finish and
unlock the emulator if needed. An empty Chrome result means the selected image
needs Chrome before this login flow can run.

Disable animations on this test device, matching CI:

```sh
adb -s "$ANDROID_UDID" shell settings put global window_animation_scale 0
adb -s "$ANDROID_UDID" shell settings put global transition_animation_scale 0
adb -s "$ANDROID_UDID" shell settings put global animator_duration_scale 0
```

### 3. Start Nextcloud with URLs Android can reach

The host browser, both Nextcloud containers, and Android must all reach the
**same canonical URLs**. On macOS, use the host's LAN IPv4 address; the following
reads interface `en0`. If you use another network interface, adjust it or set
`journey_host` to that interface's actual IPv4 address before continuing.

```sh
journey_host="$(ipconfig getifaddr en0)"
export NEXTCLOUD_STACK_ENV_FILE="$(node examples/nextcloud-filesharing/android/configure-stack.mjs "$journey_host")"
pnpm --filter @openuji/example-nextcloud-filesharing stack:up
pnpm --filter @openuji/example-nextcloud-filesharing stack:provision
pnpm --filter @openuji/example-nextcloud-filesharing stack:seed

curl --fail "http://$journey_host:18081/status.php"
curl --fail "http://$journey_host:18082/status.php"
```

On Linux, CI chooses the Docker host bridge address instead:

```sh
journey_host="$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')"
```

Run the configuration/provisioning commands above after choosing that address.
`configure-stack.mjs` writes `.android/stack.env`, keeping both service URLs and
the federated recipient consistent. Export `NEXTCLOUD_STACK_ENV_FILE` in every
terminal used to provision services or run tests. Open both status URLs in the
emulator's Chrome too; resolve connectivity or host firewall issues before
starting the test. Do not replace every URL with `localhost` or `10.0.2.2`:
those addresses do not identify the same host from all participants.

### 4. Run the same helper as CI

In the main terminal, with the exports above still set:

```sh
bash examples/nextcloud-filesharing/android/run-ci.sh
pnpm exec journey-mesh report examples/nextcloud-filesharing/test-results
```

Leave port 4723 free for the helper; it starts its own Appium server. It runs
`native-recipient-sharing` from `journey.yaml`, covering both
`default-web-touch-android` and `keyboard-only-web-touch-android`. Device properties,
Appium logs, and logcat are saved under `.tmp/android-logs/`; journey artifacts
are under `examples/nextcloud-filesharing/test-results/native-recipient-sharing/`.
The helper leaves the emulator and Nextcloud stack running for another run.

### Run the YAML command directly, including all tests

To use the generic CLI directly, keep the same emulator and services running,
and start Appium yourself in another terminal from the repository root:

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk" # use your actual SDK location
export APPIUM_HOME="$PWD/.tmp/appium"
pnpm --filter @openuji/example-nextcloud-filesharing exec appium --address 127.0.0.1 --port 4723 --log-level warn
```

Back in the main terminal, wait for Appium readiness and run either selection:

```sh
curl --fail http://127.0.0.1:4723/status
pnpm exec journey-mesh test examples/nextcloud-filesharing/journey.yaml --test native-recipient-sharing
# Or run every test declared in the same YAML, including browser-sharing:
pnpm exec journey-mesh test examples/nextcloud-filesharing/journey.yaml
```

Keep `ANDROID_UDID`, `APPIUM_URL`, and `NEXTCLOUD_STACK_ENV_FILE` exported in the
main terminal. Do not start the CI helper while this manual Appium server is
using port 4723.

### Stop the local runtime

If you started Appium manually, stop it with Ctrl+C. In the main terminal:

```sh
adb -s "$ANDROID_UDID" emu kill
NEXTCLOUD_STACK_ENV_FILE="$NEXTCLOUD_STACK_ENV_FILE" docker compose --env-file "$NEXTCLOUD_STACK_ENV_FILE" -f examples/nextcloud-filesharing/deployment/compose.yaml stop
```

This retains service volumes and reports. For a full reset that **also deletes
the example's service volumes**, use
`pnpm --filter @openuji/example-nextcloud-filesharing stack:reset` instead.

The local launcher was verified on the dedicated API 35 arm64 AVD with both
native-recipient profiles passing. CI targets API 35 x86_64 separately; this local
result does not establish that CI target's result. Detailed native bindings,
evidence limits, and review status are in [Nextcloud Android](../../docs/nextcloud-android.md).

</details>

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
The launcher has passed both native-recipient profiles locally on API 35 arm64.
The API 35 x86_64 CI target requires its own successful workflow run.
