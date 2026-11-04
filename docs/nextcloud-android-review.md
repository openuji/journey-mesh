# Nextcloud Android review dispositions

Follow-up review, 2026-11-03. Small correctness fixes are implemented below;
larger changes remain explicit follow-ups. The completed device gate used API 37
arm64. It does not validate the API 35 x86_64 CI environment.

## Implemented fixes

- **Nested locator scope:** contexts retain the complete ordered ancestor chain,
  including nested contexts. The XPath regression accepts
  `outer → nested → inner → target` and rejects escaped, reversed, and sibling
  scopes, for both standalone locators and observation bindings.
- **Portable attached reports:** generated native HTML embeds escaped hierarchy
  XML and PNG screenshots. Its evidence links survive Playwright attachment
  renaming and copying. A regression copies and renames the report, removes its
  original evidence files, and checks all 36 links and 18 images. Resource reads
  stay at the I/O boundary; rendering remains pure and publication remains atomic
  at the bundle-reference level.
- **Shared wildcard rules (finding 1):** `AccessibleFeature.value === "*"` means
  unconstrained in both translators, including Playwright's `expanded` option.
  Wildcard surface-instance keys add no restriction; both adapters reject
  concrete resolvers. Playwright previously ignored concrete resolvers too.
  A shared translation table covers accepted wildcard cases and rejected
  concrete semantics. Native queries now require displayed targets and retain
  structural ancestor contexts even when those containers are invisible.
  This does not make platform role vocabularies or name matching identical.
- **Early native validation (finding 2):** Appium compiles state and input
  transition targets through the existing resource-free `describeOperation`
  hook. The router already delegates this hook only to the owning child, before
  fixture setup or adapter creation. A bad native target therefore fails before
  Alice changes service state. No new runner interface was needed. Tests cover
  an unsupported native role alongside web-only semantics, valid routing, and
  no-input transitions that intentionally have no target. Modality decisions
  remain profile-dependent and fail before native target lookup or activation.
- **CI consistency (part of finding 3):** all actions in the Android workflow
  use commit SHAs. `android:check` compares the runtime manifest with exact
  Appium, UiAutomator2, and WebdriverIO dependency pins; validates image/API and
  English locale; and supplies emulator settings to CI. It runs before local
  `e2e:android` too. This check cannot establish network/device compatibility.
- **Clipped touch targets (finding 6):** reports and check messages now explain
  that viewport/ancestor clipping can reduce captured bounds. UiAutomator2's
  [bounds documentation](https://appium.github.io/appium-uiautomator2-driver/latest/reference/element-attributes/)
  describes this trimming. The heuristic still reports potential sizes below
  48 × 48 dp; manual review must consider clipping and expanded hit areas before
  using strict mode as a gate.
- **Migration and command dispatch (findings 7 and 8):** `MIGRATION.md` now names
  the actual runner, profiles, execution-model, and observer packages. Native
  interaction dispatch switches exhaustively on `AppiumInteractionCommand`;
  adding another command requires implementing its branch rather than silently
  tapping.
- **Portability guard:** the VM check now executes a nonempty plan covering
  state, input and no-input transitions, effect verification, control flow,
  entry reuse, progress, immutable evidence, and failure cleanup. The runner's
  main module graph has no Node imports or globals in that VM. Node types still
  support the separate `/console` entry point. WebdriverIO sessions and native
  artifact collection remain Node integrations; their runtime portability is
  not asserted by this check.

## Remaining integration gate: API 35 CI (finding 3)

**Open.** The workflow has not run on API 35 x86_64. API 37 arm64 fixture capture
and the successful local mixed run do not prove this target works. In particular,
Android/Chrome reachability to the Linux Docker bridge gateway is unverified.
The workflow is part of the current uncommitted implementation; it must be
published before GitHub can dispatch it.

Before treating Android CI as validated, run `workflow_dispatch` on the published
branch and retain evidence showing both composite profiles complete native
acceptance and mounted-file verification. Check the uploaded device properties
against API 35 x86_64, the canonical URLs from host/containers/Android, Appium and
logcat output, native hierarchy/screenshot reports, runner provenance, and web
axe artifacts. Confirm cleanup on a failed run as well as a successful run.
Resolve any platform or bridge-network differences before closing this gate.

## Deferred robustness: transient lookup errors (finding 4)

**Open; fail-fast behavior retained.** `assertCount` and the driver's
`waitForNativeChoice` retry count mismatches but propagate `findElements`
exceptions immediately. A transient UiAutomator2 error during an animation can
therefore fail a profile even when the control would appear before the deadline.

A fix needs a shared, bounded policy for read-only lookups: classify retryable
protocol errors, keep one deadline, and preserve the final underlying error.
Invalid selectors and lost sessions must fail immediately. A failed lookup must
never count as zero matches, and interaction commands must not be replayed by
that policy. Cover transient failure followed by success, terminal errors,
deadline exhaustion, zero-count assertions, and no duplicated taps/effects.

## Retained model limit: absence on the wrong screen (finding 5)

**Documented; model unchanged.** `bob-pending-share-offer-cleared` requires zero
pending-offer matches. In isolation it can pass on another screen. The preceding
OCS effect check and following native back-navigation target mitigate this in
the complete journey.

A stronger state contract would need independent positive and negative target
assertions. Combining another locator with the current binding intersection or
alternative-binding union does not express those separate expected counts.
If that contract is extended, add a regression in which the offer is absent on
an unrelated screen and require the state assertion itself to fail there.

## Deferred refactor: shared observer internals (finding 7)

**Open.** Axe and Android duplicate immutable snapshot helpers and portions of
plan snapshot/provenance projection. Extracting them crosses both observers and
their published evidence contracts; it is larger than this review's fixes.

A shared helper should preserve detached frozen values, run separation,
observation precedence, foreign-attempt versus unreached classification,
collection-error journaling, and strict policy over all completed checks. Keep
the existing observer parity regressions while migrating either implementation;
do not move runtime handles into shared facts or make rendering append evidence.

## YAML runtime verification, 2026-11-04

The generic CLI and single `journey.yaml` replaced the platform-specific test
harnesses. Local verification completed both `browser-sharing` profiles and both
`native-recipient-sharing` profiles against the real Nextcloud stack. Native
execution used a fresh workspace-owned API 37 arm64-v8a emulator, pinned APK,
Appium 3.9.0, and UiAutomator2 8.7.3. All four functional executions and their
reporters passed. Generated HTML artifacts were checked for local link targets.

This verifies selected-journey composition and standalone reporting locally. It
does not close the API 35 x86_64 GitHub Actions gate described above.
