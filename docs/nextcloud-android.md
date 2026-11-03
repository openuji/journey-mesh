# Nextcloud Android migration

The first iteration supplies [runtime-neutral adapter contracts](automation-adapters.md),
touchpoint routing, model-defined modalities, composed interaction profiles,
shared environment hooks, and per-operation adapter provenance. The runnable
Nextcloud example still uses web UI for Alice and Bob.

## Driver reuse

`nextcloudDriver()` returns a `PlaywrightJourneyDriver`. Its sessions contain
Playwright `BrowserContext` and `Page` objects; its entry, login, and readiness
helpers use browser navigation and DOM locators. Appium needs a native session
implementation.

| Existing code | Android reuse |
| --- | --- |
| Touchpoint server URLs and actor credentials | Reuse service configuration; add native app/device configuration separately. |
| `nextcloudFetch`, `ocsUrl`, `davFileUrl`, share listing/deletion, file fixture helpers | Reuse HTTP setup, cleanup, and effect verification. |
| `nextcloudEnvironment` in `environment.ts` | Reuse directly as the shared runner environment, once per profile. |
| `nextcloudDriverOptions` in `environment.ts` | Retain web entries for Alice; supply native entries and sessions for Bob. |
| Transition values | Reuse values; providers that access `session.page` need adaptation. |
| Browser sessions, login, route navigation, dialog dismissal, application settling | Supply native implementations. |
| State/transition IDs and artifact/effect semantics | Preserve where the native app exposes the same behavior; bind observations to actual controls. |

The Nextcloud package still exports HTTP helpers alongside its browser driver and
has a Playwright dependency. A separate service-helper export/package can follow;
the existing driver itself is not transport-independent.

## Next implementation

The official [Nextcloud Android manual](https://github.com/nextcloud/android/blob/master/user_manual/android_app.rst)
documents file sharing, including federated shares. The selected APK still needs
a device check for Bob's incoming federated-share acceptance and file access.
The web pending-shares route and Shares overview locators do not establish native
UI support.

1. Implement `journey-adapter-appium` using the existing adapter lifecycle, native
   locator resolution, device-session cleanup, and supported model modality IDs.
   No shared command union needs changing. Appium's [UiAutomator2 driver](https://github.com/appium/appium-uiautomator2-driver)
   supplies native Android automation and hierarchy/element data.
2. Add the Nextcloud native driver/session implementation. Keep service fixture
   setup, cleanup, and effect checks in the runner environment shared by both
   adapters.
3. Update Bob's UJG touchpoint, entry binding, surfaces, locators, and input
   modalities together with their executable Android mapping. Keep Alice on web;
   use `touchpointProfile` to select web input for Alice and touch input for Bob.
4. Attach an OSS `AndroidAccessibilityObserver` to the native adapter. Record
   native hierarchy evidence with clear limits on the implemented checks. Keep
   axe on the web adapter. Appium interaction alone does not establish TalkBack
   behavior.
5. Run the mixed journey on an emulator/device and collect progress and evidence
   against the model's state/transition IDs and executing adapters.

Contract tests run the Nextcloud plan through the Playwright adapter over browser
test doubles and a native stand-in using an arbitrary model modality ID. They
cover shared fixtures, effect checks, profile applicability, progress, provenance,
and failure cleanup. They do not install an APK or validate Android accessibility.
