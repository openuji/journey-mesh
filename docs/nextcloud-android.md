# Nextcloud Android

The mixed example runs Alice in Playwright and Bob in the Nextcloud Android app.
The existing web example and its two web profiles remain available through `e2e`.
`e2e:android` runs `default-web-touch-android` and
`keyboard-only-web-touch-android`: keyboard-only applies to Alice's web touchpoint;
Bob uses the model's `urn:openuji:input:touch-tap` modality in both executions.

## Runtime and native gate

[`android/runtime.json`](../examples/nextcloud-filesharing/android/runtime.json)
pins Nextcloud Android 35.0.2, its non-Google-Play APK and published SHA-256,
Appium 3.9.0, UiAutomator2 8.7.3, WebdriverIO 9.20.0, and the API 35 CI image.
The download script and executable both verify the APK checksum. UiAutomator2 9
requires Appium 4; do not replace the pinned driver with an unversioned install.
See the [official compatibility matrix](https://appium.github.io/appium-uiautomator2-driver/latest/getting-started/).

The native gate was exercised on a fresh temporary Pixel 6 emulator using the
locally available API 37 Google APIs arm64 image, with the pinned APK and English
UI. The captured [hierarchy fixtures](../examples/nextcloud-filesharing/android/fixtures/) establish:

1. Native account setup through Nextcloud's normal Chrome login/authorization flow.
2. Receipt of Alice's offer in the native Notifications screen.
3. Acceptance with the actual native **Accept** button.
4. Disappearance of the pending notification.
5. Visibility of `report.pdf` in the native **Shared** view, with the accepted
   mount independently verified through OCS and WebDAV.

The full mixed run uses these same native bindings. API 35 is the separate CI
baseline; fixture capture on API 37 does not establish an API 35 CI result.
The workflow has not yet completed an API 35 x86_64 run. Its Docker bridge
reachability and full mixed execution remain an integration gate; see the
[review dispositions and remaining checks](nextcloud-android-review.md).
When changing the APK, repeat the gate and update the bindings and fixtures. An
unsupported native action must be reported explicitly; service APIs must not
perform a modeled acceptance on Bob's behalf.

## Local execution

Use Node 22.22.2 or newer in the Node 22 line, JDK 21, the Android SDK, Docker,
and a dedicated Android emulator or test device with Chrome. The driver reinstalls the Nextcloud APK
for each profile, including removal on session cleanup, and resets Chrome data
for isolated account setup. A data-only reset can
leave Android account records behind. Use an English UI; the CI image is
`system-images;android-35;google_apis;x86_64`. On Apple Silicon, use the matching
arm64 Android image. Start the device before running the example.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @openuji/example-nextcloud-filesharing android:check
pnpm --filter @openuji/example-nextcloud-filesharing android:apk

export ANDROID_HOME="$HOME/Library/Android/sdk" # adjust for your SDK location
export PATH="$ANDROID_HOME/platform-tools:$PATH"
export ANDROID_UDID=emulator-5554 # use the dedicated device from adb devices
export APPIUM_HOME="$PWD/.tmp/appium"

# Choose this machine's address reachable from Android and Docker containers.
export NEXTCLOUD_STACK_ENV_FILE="$(node examples/nextcloud-filesharing/android/configure-stack.mjs 192.168.1.10)"
pnpm --filter @openuji/example-nextcloud-filesharing stack:up
pnpm --filter @openuji/example-nextcloud-filesharing stack:provision
pnpm --filter @openuji/example-nextcloud-filesharing stack:seed

pnpm --filter @openuji/example-nextcloud-filesharing exec appium driver install --source=local "$PWD/examples/nextcloud-filesharing/node_modules/appium-uiautomator2-driver"
pnpm --filter @openuji/example-nextcloud-filesharing exec appium --address 127.0.0.1 --port 4723 --log-level warn
```

In another terminal with the same environment, run:

```sh
pnpm --filter @openuji/example-nextcloud-filesharing e2e:android
pnpm --filter @openuji/example-nextcloud-filesharing exec journey-mesh report test-results
```

`APPIUM_URL` defaults to `http://127.0.0.1:4723/`. `NEXTCLOUD_ANDROID_APK` may point
to an already downloaded copy of the exact pinned APK. `ANDROID_A11Y_STRICT=1`
makes hierarchy findings fail reporting after artifacts are written. Findings
are reported without failing by default; functional and configured collection
failures always fail execution.

The generated `.android/stack.env` keeps the host, server URLs, and federated
recipient consistent. The host, both Nextcloud containers, Chrome on Android,
and the native app must reach those canonical URLs. A blanket replacement with
`10.0.2.2` does not supply a hostname reachable from the containers. Linux CI
uses the Docker host bridge address. The default web setup remains unchanged.

Stop the Appium process when finished. `stack:reset` removes the test stack and
its volumes; the dedicated emulator can be stopped independently.

## Model, driver, and shared services

The checked-in `filesharing.android.ujg.yaml` and `.jsonld` are a separate UJG
1.0-rc1 variant. The JSON-LD document is compiled directly. Alice's bindings and
the domain state/effect/artifact IDs retain their web meanings. Bob's native
entry opens Notifications after login. Explicit native transitions return from
Notifications, open the sidebar, and select Shared; those actions are not hidden
inside a transition-completion hook. The pinned APK renders the offer subject
with a literal `{user}` placeholder, which the recorded binding reflects.

`@openuji/journey-adapter-appium` implements the existing adapter lifecycle. Its
pure query compiler maps `button`, `text`, `textbox`, `checkbox`, `list`,
`android.view.ViewGroup`, `android.widget.TextView`, and `android.widget.Button`
roles explicitly. It supports native
`resource-id`, `class`, `text`, `content-desc`, `clickable`, `enabled`, `selected`,
and `checked` features. Names match exact text or content descriptions. Contexts
scope ancestors in model order; locators within a binding intersect and bindings
form a union. Targets must be displayed; invisible ancestor containers may still
scope visible descendants. Feature values of `"*"` and wildcard instance keys
are unconstrained, matching the web translator's rule. Unknown roles, unsupported
concrete features, accessible descriptions, and concrete surface-instance resolvers
are rejected. Model values are escaped as XPath literals.
The resource-free `describeOperation` hook validates native state and
input-transition targets before service setup or Alice's actions, using only
operations routed to Appium. No-input transitions skip target validation.

`@openuji/journey-driver-nextcloud-android` owns application entry, scripted
login, readiness, and sessions keyed by actor/touchpoint. Each isolated actor
needs its own dedicated device. Sessions are registered with the adapter before
login; the adapter closes every allocated session even when login or driver
cleanup fails. No-input transitions wait without inventing a tap.

`@openuji/journey-driver-nextcloud/service` exports the existing service types
and HTTP helpers without browser runtime imports. Root exports remain compatible;
the package still has its existing Playwright dependency. `environment.ts` owns
configured fixture and effect checks; `journey.yaml` owns
web entry configuration. Both runtimes share the configured environment once per
profile. Pending offers are declined through the pending-share endpoint, including
after a failed login; accepted mounts use the accepted-share endpoint.

## Native evidence and pure processing

The Android observer implements `AppiumExecutionObserver` and `JourneyReporter`.
The collector snapshots operation metadata before asynchronous I/O, captures
hierarchy XML, display density/platform version, matched element identities, and
PNG screenshots, then appends deeply frozen facts. Password-node text is redacted
from hierarchy evidence; account setup is outside the audited journey.

`parseAndroidHierarchy`, `checkAndroidHierarchy`,
`buildAndroidAccessibilityReport`, and `renderAndroidAccessibilityReport` are
pure processors. Reports take explicit timestamps and immutable evidence; reads
and rendering never append facts. Device handles, scans, clock reads, journal
appends, and artifact reads/writes remain at I/O boundaries.
`loadAndroidReportResources` reads captured artifacts before publication and passes
frozen XML/PNG resources explicitly into the pure HTML renderer. Custom artifact
stores supply `readArtifact`; the default reads `artifact.path` from disk.
Content-addressed report bundles include those resources in their identity and
preserve prior published artifacts if a later read or write fails.

The initial checks flag potential missing labels on visible enabled actionable
nodes and potential touch targets below 48 × 48 dp. Labels include non-actionable
descendant groups. Missing visibility/enabled attributes, bounds, or density
remain unassessed. Expanded hit areas and actual screen-reader grouping can
differ from captured attributes. UiAutomator2 bounds can also be clipped by the
viewport or ancestor containers, so partly visible controls can produce small
reported sizes. Review such findings manually, especially with strict mode.
See the [UiAutomator2 element attributes](https://appium.github.io/appium-uiautomator2-driver/latest/reference/element-attributes/).
These heuristics establish neither TalkBack behavior nor WCAG conformance.

The native JSON/HTML report projects the latest observation per operation.
Its separate `.evidence.json` journal retains all observations; strict policy
examines every completed check in the run. Collection errors are journaled before
they fail an operation. Actual observations take precedence over adapter
attribution; foreign attempts are not applicable and unreached operations remain
skipped. Functional outcomes stay intact. Axe remains attached only to Playwright
and classifies attempted native operations using runner adapter provenance.

Artifacts are written under `test-results/native-recipient-sharing/` and linked from the Journey Mesh HTML index:
runner evidence, runtime manifest, web axe reports, native hierarchy XML and PNGs,
the native evidence journal, native JSON/HTML reports, and the journey summary.
Generated native HTML is self-contained: hierarchy links target escaped XML within
the document, and screenshot links target embedded PNGs. Playwright attachment
renaming and copying into its HTML report do not change those links. Individual
XML/PNG attachments and the JSON evidence retain their original formats.
The Android CI workflow runs on pull requests and manual dispatch, uploads
artifacts/logs even on failure, and cleans owned Appium/logcat processes, the
emulator, and the service stack.
All workflow actions are pinned to commit SHAs. `android:check` verifies the
manifest against the declared tool dependency pins and supplies the CI API,
image target, architecture, and device profile from that manifest. The same
check runs before `e2e:android`; it checks configuration consistency, not device
compatibility. Deferred robustness and evidence-refactoring work is recorded in
the [review dispositions](nextcloud-android-review.md).

## YAML execution entrypoint

Both reference tests now live in [`journey.yaml`](../examples/nextcloud-filesharing/journey.yaml).
The generic command is `journey-mesh test journey.yaml --test native-recipient-sharing`.
The `e2e:android` alias first checks tool pins and then invokes this command.
There is no Android or mixed Playwright Test runner. Native adapter, device,
entry handler, model selection, touch profiles, observers, and reporting policy
are all declared in YAML. The existing provisioning and emulator/Appium tooling
remains separate. See [YAML test configuration](yaml-tests.md).
